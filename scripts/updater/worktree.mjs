import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const INIT_PATH = "scripts/init.sh";

/**
 * Old bootstrap versions chmodded init.sh even though they ran it via bash.
 * Repair ONLY that known unstaged executable-bit change, never script content,
 * staged changes, symlinks, other files, or a genuinely executable Git entry.
 */
export async function repairLegacyInitMode(repoDir) {
  const root = path.resolve(repoDir);
  const git = async (...args) => (await exec("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024
  })).stdout;
  const status = await git("status", "--porcelain=v1", "--untracked-files=no", "--", INIT_PATH);
  if (status.trimEnd() !== ` M ${INIT_PATH}`) return { repaired: false };
  const filePath = path.join(root, INIT_PATH);
  const entry = await lstat(filePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry?.isFile() || !(entry.mode & 0o100)) return { repaired: false };

  const [head, index] = await Promise.all([
    git("ls-tree", "-z", "HEAD", "--", INIT_PATH),
    git("ls-files", "--stage", "-z", "--", INIT_PATH)
  ]);
  const headMatch = /^100644 blob ([a-f0-9]{40}|[a-f0-9]{64})\tscripts\/init\.sh\0$/.exec(head);
  const indexMatch = /^100644 ([a-f0-9]{40}|[a-f0-9]{64}) 0\tscripts\/init\.sh\0$/.exec(index);
  if (!headMatch || !indexMatch || headMatch[1] !== indexMatch[1]) return { repaired: false };

  const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.ino !== entry.ino || before.dev !== entry.dev) {
      throw new Error("安装脚本在检查时已被替换，未修改权限");
    }
    const content = await file.readFile();
    const hash = createHash(headMatch[1].length === 64 ? "sha256" : "sha1")
      .update(`blob ${content.length}\0`).update(content).digest("hex");
    if (hash !== headMatch[1]) return { repaired: false };

    // Git metadata is outside the worktree status scan, including linked worktrees.
    const backupRoot = path.resolve(root, (await git("rev-parse", "--git-path", "shibei-updater-backups")).trim());
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const backupDir = await mkdtemp(path.join(backupRoot, "init-mode-"));
    const originalMode = before.mode & 0o7777;
    const restoredMode = originalMode & ~0o111;
    await writeFile(path.join(backupDir, "init.sh"), content, { mode: 0o600 });
    await writeFile(path.join(backupDir, "metadata.json"), JSON.stringify({
      path: INIT_PATH, headBlob: hash, originalMode: originalMode.toString(8),
      restoredMode: restoredMode.toString(8), createdAt: new Date().toISOString()
    }, null, 2) + "\n", { mode: 0o600 });

    const [current, location] = await Promise.all([file.stat(), lstat(filePath)]);
    if (current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs ||
        location.ino !== before.ino || location.dev !== before.dev || !location.isFile()) {
      throw new Error("安装脚本在检查时已变化，已保留备份但未修改权限");
    }
    await file.chmod(restoredMode);
    return { repaired: true, path: INIT_PATH, backupDir, originalMode, restoredMode };
  } finally {
    await file.close();
  }
}

// A narrowly scoped, non-destructive repair entry point for existing installations.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await repairLegacyInitMode(process.argv[2] || process.cwd());
    console.log(result.repaired
      ? `已修复 scripts/init.sh 的纯执行权限差异；内容未修改。备份：${result.backupDir}`
      : "未发现可安全修复的历史执行权限差异；文件未修改。请查看 git diff 和 git status。");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
