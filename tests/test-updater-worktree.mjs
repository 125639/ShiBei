import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm, symlink, unlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { repairLegacyInitMode } from "../scripts/updater/worktree.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const git = async (repo, ...args) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
const script = "#!/usr/bin/env bash\nprintf 'init-ran\\n'\n";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shibei-updater-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const origin = path.join(dir, "origin");
  const repo = path.join(dir, "repo");
  await mkdir(path.join(origin, "scripts"), { recursive: true });
  await git(origin, "init", "-b", "main");
  await git(origin, "config", "user.name", "Updater test");
  await git(origin, "config", "user.email", "test@example.invalid");
  await git(origin, "config", "core.filemode", "true");
  await writeFile(path.join(origin, "scripts/init.sh"), script, { mode: 0o644 });
  await writeFile(path.join(origin, "README.md"), "original\n");
  await writeFile(path.join(origin, ".gitignore"), ".env\n");
  await writeFile(path.join(origin, "docker-compose.yml"), "services: {}\n");
  await git(origin, "add", ".");
  await git(origin, "commit", "-m", "initial");
  await exec("git", ["clone", origin, repo]);
  await git(repo, "config", "core.filemode", "true");
  return { dir, origin, repo, init: path.join(repo, "scripts/init.sh") };
}

test("bootstrap invokes a non-executable installer without dirtying fresh or existing clones", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.dir, "bootstrap-target");
  for (let i = 0; i < 2; i++) {
    const run = await exec("bash", [path.join(root, "scripts/bootstrap.sh")], {
      env: { ...process.env, SHIBEI_REPO: f.origin, SHIBEI_BRANCH: "main", SHIBEI_DIR: target, NO_COLOR: "1" }
    });
    assert.match(run.stdout, /init-ran/);
    assert.equal(await git(target, "status", "--porcelain"), "");
    assert.equal((await stat(path.join(target, "scripts/init.sh"))).mode & 0o111, 0);
  }
});

test("legacy mode-only changes are backed up and repaired without altering bytes or index", async (t) => {
  const f = await fixture(t);
  const indexBefore = await git(f.repo, "ls-files", "--stage");
  await chmod(f.init, 0o775);
  assert.equal(await git(f.repo, "status", "--porcelain"), "M scripts/init.sh");
  const result = await repairLegacyInitMode(f.repo);
  assert.equal(result.repaired, true);
  assert.equal((await stat(f.init)).mode & 0o777, 0o664, "preserve non-executable permission bits");
  assert.equal(await readFile(f.init, "utf8"), script);
  assert.equal(await git(f.repo, "ls-files", "--stage"), indexBefore);
  assert.equal(await git(f.repo, "status", "--porcelain"), "");
  assert.equal(await readFile(path.join(result.backupDir, "init.sh"), "utf8"), script);
  const metadata = JSON.parse(await readFile(path.join(result.backupDir, "metadata.json"), "utf8"));
  assert.equal(metadata.originalMode, "775");
  assert.equal(metadata.restoredMode, "664");
  assert.deepEqual(await repairLegacyInitMode(f.repo), { repaired: false });
});

test("real script edits are retained and remain dirty", async (t) => {
  const f = await fixture(t);
  const edited = script + "# administrator customization\n";
  await writeFile(f.init, edited);
  await chmod(f.init, 0o755);
  assert.equal((await repairLegacyInitMode(f.repo)).repaired, false);
  assert.equal(await readFile(f.init, "utf8"), edited);
  assert.equal((await stat(f.init)).mode & 0o777, 0o755);
  assert.match(await git(f.repo, "status", "--porcelain"), /scripts\/init.sh/);
});

test("staged content and staged mode edits are never repaired", async (t) => {
  for (const kind of ["content", "mode"]) {
    const f = await fixture(t);
    if (kind === "content") {
      await writeFile(f.init, script + "# staged change\n");
      await git(f.repo, "add", "scripts/init.sh");
    } else {
      await git(f.repo, "update-index", "--chmod=+x", "scripts/init.sh");
    }
    await chmod(f.init, 0o755);
    const before = await git(f.repo, "diff", "--cached");
    assert.equal((await repairLegacyInitMode(f.repo)).repaired, false);
    assert.equal(await git(f.repo, "diff", "--cached"), before);
  }
});

test("symlinks, unrelated file modes and ignored filemode changes are left untouched", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.dir, "outside.sh");
  await writeFile(outside, script, { mode: 0o755 });
  await unlink(f.init);
  await symlink(outside, f.init);
  assert.equal((await repairLegacyInitMode(f.repo)).repaired, false);
  assert.equal((await stat(outside)).mode & 0o777, 0o755);
  await unlink(f.init);
  await writeFile(f.init, script, { mode: 0o644 });
  await chmod(path.join(f.repo, "README.md"), 0o755);
  assert.equal((await repairLegacyInitMode(f.repo)).repaired, false);
  assert.match(await git(f.repo, "status", "--porcelain"), /README/);
  await git(f.repo, "config", "core.filemode", "false");
  await chmod(f.init, 0o755);
  assert.equal((await repairLegacyInitMode(f.repo)).repaired, false);
  assert.equal((await stat(f.init)).mode & 0o777, 0o755);
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function runUpdate(f) {
  const bin = path.join(f.dir, "bin");
  const home = path.join(f.dir, "home");
  await mkdir(bin); await mkdir(home);
  const dockerLog = path.join(f.dir, "docker.log");
  await writeFile(path.join(bin, "docker"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"\n', { mode: 0o755 });
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  let output = "";
  const child = spawn(process.execPath, [path.join(root, "scripts/updater/server.mjs")], {
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, REPO_DIR: f.repo,
      UPDATER_PORT: String(port), UPDATER_TOKEN: token, UPDATE_BRANCH: "main",
      COMPOSE_PROJECT_NAME: "test-original-project", DEPLOY_SOURCE: "pull", FAKE_DOCKER_LOG: dockerLog }
  });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (await fetch(base + "/health").then((r) => r.ok).catch(() => false)) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(ready, output);
    assert.equal((await fetch(base + "/update", { method: "POST" })).status, 401);
    assert.equal((await fetch(base + "/update", { method: "POST", headers })).status, 202);
    for (let i = 0; i < 200; i++) {
      const status = await fetch(base + "/status", { headers }).then((r) => r.json());
      if (!status.running && status.finishedAt) return { status, docker: await readFile(dockerLog, "utf8").catch(() => "") };
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`updater did not settle: ${output}`);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  }
}

test("real updater HTTP flow repairs the bootstrap artifact, fast-forwards, then deploys", async (t) => {
  const f = await fixture(t);
  await chmod(f.init, 0o755);
  await writeFile(path.join(f.origin, "release.txt"), "new release\n");
  await git(f.origin, "add", "."); await git(f.origin, "commit", "-m", "release");
  const { status, docker } = await runUpdate(f);
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), await git(f.origin, "rev-parse", "HEAD"));
  assert.equal(await git(f.repo, "status", "--porcelain"), "");
  assert.ok(status.log.some((line) => line.includes("备份") && line.includes("执行权限")));
  assert.match(docker, /compose -p test-original-project .* pull app worker/);
  assert.match(docker, /up -d --no-deps app worker/);
  assert.doesNotMatch(docker, / build /);
});

test("real updater still refuses content edits, untracked files, staged changes, local commits and wrong branches", async (t) => {
  for (const kind of ["content", "untracked", "staged", "local-commit", "branch"]) {
    const f = await fixture(t);
    const head = await git(f.repo, "rev-parse", "HEAD");
    if (kind === "content") { await writeFile(f.init, script + "# custom\n"); await chmod(f.init, 0o755); }
    if (kind === "untracked") await writeFile(path.join(f.repo, "custom.txt"), "keep me");
    if (kind === "staged") { await writeFile(f.init, script + "# staged\n"); await git(f.repo, "add", "."); }
    if (kind === "local-commit") {
      await git(f.repo, "config", "user.name", "test"); await git(f.repo, "config", "user.email", "test@example.invalid");
      await writeFile(path.join(f.repo, "custom.txt"), "keep me"); await git(f.repo, "add", "."); await git(f.repo, "commit", "-m", "local");
    }
    if (kind === "branch") await git(f.repo, "checkout", "-b", "custom-branch");
    const before = await git(f.repo, "status", "--porcelain");
    const { status, docker } = await runUpdate(f);
    assert.equal(status.ok, false, `${kind}: ${JSON.stringify(status)}`);
    assert.equal(docker, "", `${kind}: no deployment commands may run`);
    assert.equal(await git(f.repo, "status", "--porcelain"), before);
    if (kind !== "local-commit") assert.equal(await git(f.repo, "rev-parse", "HEAD"), head);
    if (kind === "content") assert.equal(await readFile(f.init, "utf8"), script + "# custom\n");
    if (kind === "untracked") assert.equal(await readFile(path.join(f.repo, "custom.txt"), "utf8"), "keep me");
  }
});

test("updater image includes the mode-repair dependency", async () => {
  const dockerfile = await readFile(path.join(root, "Dockerfile.updater"), "utf8");
  assert.match(dockerfile, /COPY scripts\/updater\/server\.mjs scripts\/updater\/worktree\.mjs/);
});


test("repairing the known mode artifact never hides another administrator modification", async (t) => {
  const f = await fixture(t);
  await chmod(f.init, 0o755);
  await writeFile(path.join(f.repo, "docker-compose.yml"), "services: {custom: {image: private}}\n");
  const { status, docker } = await runUpdate(f);
  assert.equal(status.ok, false);
  assert.match(status.error, /docker-compose\.yml/);
  assert.equal(docker, "");
  assert.equal(await readFile(path.join(f.repo, "docker-compose.yml"), "utf8"), "services: {custom: {image: private}}\n");
  assert.equal((await stat(f.init)).mode & 0o111, 0);
});
