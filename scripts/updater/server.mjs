// ShiBei updater 伴车服务 —— 让管理员在网页上一键更新应用，不用 SSH 进服务器。
//
// 运行在独立的小容器里（见 Dockerfile.updater 与各 docker-compose 的 updater 服务），
// 挂载 /var/run/docker.sock 和仓库目录 /repo。app 容器通过 compose 内网访问它：
//
//   GET  /health   存活探针（不鉴权，无敏感信息）
//   GET  /current  当前仓库 HEAD / 分支 / origin 地址
//   POST /check    git fetch 后对比本地与 origin/<branch>，返回落后的提交列表
//   POST /update   异步执行：校验干净工作区并仅快进到 origin/<branch> → build → up -d
//   GET  /status   更新任务状态 + 日志（app 重启期间/之后都可以来拉）
//
// 安全模型：
//   - 本服务只应监听 compose 内网（compose 里不映射端口到宿主）。
//   - 除 /health 外全部要求 Authorization: Bearer <UPDATER_TOKEN>；
//     UPDATER_TOKEN 未设置时回落到 AUTH_SECRET（app 与 updater 都读同一个 .env）。
//   - 更新流程是固定命令序列，不接受任何来自请求体的参数（分支名取自仓库/环境变量），
//     不存在命令注入面。
//   - 挂载 docker.sock 等价于宿主 root，所以绝不能把本服务暴露到公网。
//
// 注意：updater 不更新它自己。改了 scripts/updater/* 或 Dockerfile.updater 之后，
// 需要手动执行一次 `docker compose up -d --build updater`（更新日志里会提示）。

import http from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.UPDATER_PORT || 9080);
const REPO_DIR = process.env.REPO_DIR || "/repo";
const TOKEN = (process.env.UPDATER_TOKEN || process.env.AUTH_SECRET || "").trim();
// 该形态对应的 compose 文件名与要重建的服务，由 compose 的 updater 服务注入。
const COMPOSE_FILE_NAME = (process.env.COMPOSE_FILE_NAME || "docker-compose.yml").trim();
const UPDATE_SERVICES = (process.env.UPDATE_SERVICES || "app worker")
  .split(/\s+/)
  .filter(Boolean);
// 只需要构建的服务（full/backend 下 app 与 worker 共用同一镜像 tag，
// 构建一次 app 即可，up 时 worker 自动用新镜像——与 scripts/deploy.sh 一致，省一半构建时间）。
const BUILD_SERVICES = (process.env.UPDATE_BUILD_SERVICES || process.env.UPDATE_SERVICES || "app")
  .split(/\s+/)
  .filter(Boolean);
// Services such as a TLS proxy need a restart after the app changes: nginx's
// envsubst templates are rendered only when the container starts (upstream DNS
// staleness is separately handled by `resolver ... valid=10s` in the config).
// IMPORTANT: this must be `docker compose restart`, never `up --force-recreate`.
// The updater runs Compose inside its own container where the repo lives at
// /repo, so a recreate would re-resolve the proxy's relative bind mounts
// (./ops/nginx/...) against /repo — a path that does not exist on the host —
// and dockerd would mount empty directories over the nginx templates, taking
// HTTPS down. `restart` keeps the original host-created container definition.
// Leave empty for installs that do not enable the optional HTTPS profile.
const RECREATE_SERVICES = (process.env.UPDATE_RECREATE_SERVICES || "")
  .split(/\s+/)
  .filter(Boolean);
// 留空 = 跟随仓库当前分支。
const UPDATE_BRANCH = (process.env.UPDATE_BRANCH || "").trim();

const LOG_LIMIT = 800; // ring buffer 行数上限

/** @type {{running:boolean, phase:string, startedAt:string|null, finishedAt:string|null, ok:boolean|null, error:string|null, log:string[]}} */
const state = {
  running: false,
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  ok: null,
  error: null,
  log: []
};

function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  state.log.push(stamped);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  console.log(stamped);
}

/**
 * 跑一个命令，stdout/stderr 逐行进日志。resolve exit code。
 * @param {string} cmd @param {string[]} args
 * @param {{cwd?: string, env?: Record<string,string|undefined>, timeoutMs?: number, quiet?: boolean}} [opts]
 * @returns {Promise<{code:number, out:string}>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || REPO_DIR,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let buf = "";
    const onChunk = (chunk) => {
      const text = String(chunk);
      out += text;
      if (opts.quiet) return;
      buf += text;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (line) logLine(`  ${line}`);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          logLine(`! 超时（${opts.timeoutMs}ms），终止：${cmd} ${args.join(" ")}`);
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (!opts.quiet) logLine(`! 启动失败：${cmd}（${err.message}）`);
      resolve({ code: 127, out });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (buf.trim() && !opts.quiet) logLine(`  ${buf.trim()}`);
      resolve({ code: code ?? 1, out });
    });
  });
}

/** git 只取输出，不进日志。 */
async function git(args, timeoutMs = 30_000) {
  const { code, out } = await run("git", ["-C", REPO_DIR, ...args], { quiet: true, timeoutMs });
  return { code, out: out.trim() };
}

async function resolveBranch() {
  if (UPDATE_BRANCH) return UPDATE_BRANCH;
  const { code, out } = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (code === 0 && out && out !== "HEAD") return out;
  return "main";
}

async function repoInfo() {
  const [head, short, branch, remote] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--short", "HEAD"]),
    resolveBranch(),
    git(["remote", "get-url", "origin"])
  ]);
  return {
    commit: head.code === 0 ? head.out : null,
    shortCommit: short.code === 0 ? short.out : null,
    branch,
    remoteUrl: remote.code === 0 ? remote.out : null
  };
}

// compose project 名自省：读本容器的 compose label，保证 build/up 落在
// 用户原来的 compose project 上（挂载路径 /repo 的目录名与宿主不同，
// 不能依赖 compose 的默认 project 推导）。
let cachedProject = null;
async function composeProject() {
  if (cachedProject) return cachedProject;
  const envProject = (process.env.COMPOSE_PROJECT_NAME || "").trim();
  if (envProject) {
    cachedProject = envProject;
    return cachedProject;
  }
  let containerId = "";
  try {
    containerId = readFileSync("/etc/hostname", "utf8").trim();
  } catch {
    /* fallthrough */
  }
  if (containerId) {
    const { code, out } = await run(
      "docker",
      ["inspect", containerId, "--format", '{{ index .Config.Labels "com.docker.compose.project" }}'],
      { quiet: true, timeoutMs: 10_000 }
    );
    const project = out.trim();
    if (code === 0 && project && project !== "<no value>") {
      cachedProject = project;
      return cachedProject;
    }
  }
  return null;
}

async function doCheck() {
  const fetched = await run("git", ["-C", REPO_DIR, "fetch", "origin", "--prune"], {
    quiet: true,
    timeoutMs: 120_000
  });
  if (fetched.code !== 0) {
    return { error: `git fetch 失败（exit ${fetched.code}）：${fetched.out.slice(-400)}` };
  }
  const branch = await resolveBranch();
  const remoteRef = `origin/${branch}`;
  const [localHead, remoteHead, behindOut, logOut] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", remoteRef]),
    git(["rev-list", "--count", `HEAD..${remoteRef}`]),
    git(["log", `HEAD..${remoteRef}`, "--pretty=format:%h%x1f%an%x1f%ad%x1f%s", "--date=iso-strict", "-n", "20"])
  ]);
  if (remoteHead.code !== 0) {
    return { error: `找不到远端分支 ${remoteRef}` };
  }
  const commits = logOut.code === 0 && logOut.out
    ? logOut.out.split("\n").map((line) => {
        const [sha, author, date, subject] = line.split("\x1f");
        return { sha, author, date, subject };
      })
    : [];
  return {
    branch,
    localCommit: localHead.out || null,
    remoteCommit: remoteHead.out || null,
    behind: Number(behindOut.out || 0),
    commits
  };
}

async function doUpdate() {
  state.running = true;
  state.ok = null;
  state.error = null;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.log = [];
  try {
    const branch = await resolveBranch();
    const project = await composeProject();
    // project 名拿不到时必须中止：不带 -p 在 /repo 下执行 compose 会推导出
    // 名为 "repo" 的全新 project，凭空建出一套空数据库的平行容器——绝不能发生。
    if (!project) {
      throw new Error(
        "无法确定 docker compose project 名（容器缺少 compose label）。请在 .env 中设置 COMPOSE_PROJECT_NAME=<原 project 名> 后重启 updater 容器。"
      );
    }
    const composeArgs = ["compose", "-p", project, "-f", `${REPO_DIR}/${COMPOSE_FILE_NAME}`];

    state.phase = "fetching";
    logLine(`开始更新：分支 ${branch}，compose 文件 ${COMPOSE_FILE_NAME}，project ${project}，构建 ${BUILD_SERVICES.join(" ")}，重启 ${UPDATE_SERVICES.join(" ")}${RECREATE_SERVICES.length ? `，强制重建 ${RECREATE_SERVICES.join(" ")}` : ""}`);
    const [dirty, currentBranch, oldHead] = await Promise.all([
      git(["status", "--porcelain"]),
      git(["rev-parse", "--abbrev-ref", "HEAD"]),
      git(["rev-parse", "HEAD"])
    ]);
    if (dirty.code !== 0) throw new Error("无法检查仓库工作区状态，已拒绝更新");
    if (dirty.out) {
      throw new Error(
        `仓库存在未提交或未跟踪文件，已拒绝更新以防数据丢失。请先由管理员备份并处理这些改动：\n${dirty.out.slice(0, 1200)}`
      );
    }
    if (currentBranch.code !== 0 || currentBranch.out !== branch) {
      throw new Error(
        `当前分支为 ${currentBranch.out || "未知"}，目标分支为 ${branch}；为避免更新错误分支，已拒绝自动切换。`
      );
    }
    let r = await run("git", ["-C", REPO_DIR, "fetch", "origin", "--prune"], { timeoutMs: 180_000 });
    if (r.code !== 0) throw new Error(`git fetch 失败（exit ${r.code}）`);
    const divergence = await git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
    if (divergence.code !== 0) throw new Error(`无法比较本地与 origin/${branch}，已拒绝更新`);
    const [aheadRaw, behindRaw] = divergence.out.split(/\s+/);
    const ahead = Number(aheadRaw);
    const behind = Number(behindRaw);
    if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
      throw new Error(`无法解析仓库差异“${divergence.out}”，已拒绝更新`);
    }
    if (ahead > 0) {
      throw new Error(`本地分支比 origin/${branch} 多 ${ahead} 个提交；自动更新不会覆盖本地提交，请人工合并。`);
    }
    r = await run("git", ["-C", REPO_DIR, "merge", "--ff-only", `origin/${branch}`], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`git 快进失败（exit ${r.code}），仓库未被强制覆盖`);

    const info = await repoInfo();
    const gitCommit = info.shortCommit || "unknown";
    const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    logLine(`仓库已更新到 ${gitCommit}，开始构建镜像（可能需要几分钟）…`);

    // updater 自身的文件变了要提醒手动重建一次（它不自更新）。
    const selfChanged = oldHead.code === 0
      ? await git(["diff", "--name-only", oldHead.out, "HEAD", "--", "scripts/updater", "Dockerfile.updater"])
      : { code: 1, out: "" };
    if (selfChanged.code === 0 && selfChanged.out) {
      logLine("提示：本次更新修改了 updater 自身，稍后请在服务器上执行一次 `docker compose up -d --build updater` 使其生效。");
    }

    state.phase = "building";
    const buildEnv = { GIT_COMMIT: gitCommit, BUILD_TIME: buildTime };
    r = await run("docker", [...composeArgs, "build", ...BUILD_SERVICES], {
      env: buildEnv,
      timeoutMs: 45 * 60_000
    });
    if (r.code !== 0) throw new Error(`docker compose build 失败（exit ${r.code}）`);

    state.phase = "starting";
    logLine("构建完成，滚动重启服务…");
    // --no-deps：只动 app/worker，绝不顺手重建 postgres/redis（数据库容器交给人工）。
    r = await run("docker", [...composeArgs, "up", "-d", "--no-deps", ...UPDATE_SERVICES], {
      env: buildEnv,
      timeoutMs: 10 * 60_000
    });
    if (r.code !== 0) throw new Error(`docker compose up 失败（exit ${r.code}）`);

    if (RECREATE_SERVICES.length) {
      logLine(`刷新入口服务：${RECREATE_SERVICES.join(" ")}…`);
      // restart（而不是 up --force-recreate）：重启会重跑 nginx entrypoint
      // 重新渲染模板并加载续期后的证书，同时保留宿主机创建容器时的正确
      // bind mount。在 updater 容器内 recreate 会把 ./ops/... 解析成宿主机
      // 不存在的 /repo/...，直接打挂 HTTPS 入口。
      r = await run(
        "docker",
        [...composeArgs, "restart", ...RECREATE_SERVICES],
        { env: buildEnv, timeoutMs: 10 * 60_000 }
      );
      if (r.code !== 0) throw new Error(`入口服务重启失败（exit ${r.code}）`);
    }

    state.phase = "done";
    state.ok = true;
    logLine(`更新完成：现在运行 ${gitCommit}。应用容器可能还需要几十秒完成迁移与预热。`);
  } catch (err) {
    state.phase = "error";
    state.ok = false;
    state.error = err instanceof Error ? err.message : String(err);
    logLine(`更新失败：${state.error}`);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(data);
}

function authorized(req) {
  if (!TOKEN) return false;
  // timing-safe 比对：虽然只在内网监听，token 校验仍不该泄露长度外的时序信息。
  const given = Buffer.from(String(req.headers.authorization || ""));
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://updater");
  const path = url.pathname;

  if (path === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!TOKEN) {
    sendJson(res, 500, {
      error: "UPDATER_TOKEN / AUTH_SECRET 未配置，updater 拒绝服务。请在 .env 设置后重启 updater 容器。"
    });
    return;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  try {
    if (req.method === "GET" && path === "/current") {
      sendJson(res, 200, await repoInfo());
      return;
    }
    if (req.method === "POST" && path === "/check") {
      if (state.running) {
        sendJson(res, 409, { error: "更新正在进行，稍后再检查。" });
        return;
      }
      const result = await doCheck();
      if (result.error) {
        sendJson(res, 502, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && path === "/update") {
      if (state.running) {
        sendJson(res, 409, { error: "已有更新在进行中。" });
        return;
      }
      void doUpdate();
      sendJson(res, 202, { started: true });
      return;
    }
    if (req.method === "GET" && path === "/status") {
      const info = await repoInfo();
      sendJson(res, 200, {
        running: state.running,
        phase: state.phase,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        ok: state.ok,
        error: state.error,
        log: state.log,
        repo: info
      });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// 宿主仓库挂载进来后属主与容器内 root 不一致，git 会拒绝操作（dubious ownership）。
run("git", ["config", "--global", "--add", "safe.directory", REPO_DIR], { quiet: true }).then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[updater] listening on :${PORT}, repo=${REPO_DIR}, compose=${COMPOSE_FILE_NAME}, build=${BUILD_SERVICES.join(",")}, up=${UPDATE_SERVICES.join(",")}, recreate=${RECREATE_SERVICES.join(",") || "none"}`);
    if (!TOKEN) {
      console.warn("[updater] 警告：UPDATER_TOKEN / AUTH_SECRET 均未设置，所有请求将被拒绝。");
    }
  });
});
