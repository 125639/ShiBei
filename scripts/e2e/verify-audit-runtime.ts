/** Real Redis multi-process locking and hostile Chromium evaluation; invoked by verify-audit-live.mjs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import { chromium } from "playwright";
import { withInFlightLock } from "../../src/lib/in-flight";
import { withEvaluateTimeout } from "../../src/lib/scrape-timeout";

const globals = globalThis as unknown as { shibeiInFlightRedis?: Redis };
const url = new URL(process.env.REDIS_URL || "redis://invalid");
if (process.env.AUDIT_LIVE_ISOLATED !== "1" || url.hostname !== "127.0.0.1" || !url.port || url.port === "6379") {
  throw new Error("This test requires the disposable Redis created by verify-audit-live.mjs");
}
const key = "audit:cross-process-paid-calls";

async function worker() {
  const counter = new Redis(url.href, { maxRetriesPerRequest: 1 });
  counter.on("error", () => undefined);
  try {
    await counter.ping();
    const go = new Promise<void>((resolve) => process.once("message", () => resolve()));
    process.send?.({ ready: true });
    await go;
    const result = await withInFlightLock("audit-cross-process", 60, async () => {
      await counter.incr(key);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return "one paid operation";
    });
    process.send?.({ result });
  } finally {
    counter.disconnect();
    globals.shibeiInFlightRedis?.disconnect();
    process.disconnect?.();
  }
}

async function main() {
  const counter = new Redis(url.href, { maxRetriesPerRequest: 1 });
  counter.on("error", () => undefined);
  try {
    await counter.del(key);
    const workers = [0, 1].map(() => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", fileURLToPath(import.meta.url), "worker"], {
        env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"]
      });
      child.stderr!.on("data", (data) => process.stderr.write(data));
      let ready!: () => void;
      const readiness = new Promise<void>((resolve) => { ready = resolve; });
      const result = new Promise<{ ok: boolean }>((resolve, reject) => {
        child.on("message", (message: { ready?: boolean; result?: { ok: boolean } }) => {
          if (message.ready) ready();
          if (message.result) resolve(message.result);
        });
        child.once("error", reject);
        child.once("exit", (code) => { if (code) reject(new Error(`worker exited ${code}`)); });
      });
      return { child, readiness, result };
    });
    const timeout = setTimeout(() => { for (const { child } of workers) child.kill("SIGKILL"); }, 15_000);
    try {
      await Promise.all(workers.map((worker) => worker.readiness));
      for (const { child } of workers) child.send("go");
      const results = await Promise.all(workers.map((worker) => worker.result));
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(await counter.get(key), "1");
      console.log("PASS two cold-start Node processes execute exactly one paid operation via real Redis");
    } finally {
      clearTimeout(timeout);
      for (const { child } of workers) if (child.exitCode === null) child.kill("SIGTERM");
    }

    let calls = 0;
    await assert.rejects(withInFlightLock("audit-business-failure", 30, async () => { calls++; throw new Error("model failure"); }), /model failure/);
    assert.equal(calls, 1);
    const first = globals.shibeiInFlightRedis!;
    const ended = new Promise<void>((resolve) => first.once("end", resolve));
    first.disconnect();
    await ended;
    assert.equal((await withInFlightLock("audit-after-end", 30, async () => 42)).ok, true);
    assert.notStrictEqual(first, globals.shibeiInFlightRedis);
    console.log("PASS a terminated Redis connection is rebuilt; business failures are not retried");

    const socket = net.createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const unusedPort = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    globals.shibeiInFlightRedis?.disconnect();
    delete globals.shibeiInFlightRedis;
    process.env.REDIS_URL = `redis://127.0.0.1:${unusedPort}`;
    const unavailable = await withInFlightLock("audit-outage", 30, async () => { calls++; });
    assert.deepEqual(unavailable, { ok: false, reason: "unavailable" });
    assert.equal(calls, 1);
    console.log("PASS an actual refused Redis connection does not execute paid work in memory");
  } finally {
    counter.disconnect();
    globals.shibeiInFlightRedis?.disconnect();
  }

  const browser = await chromium.launch({ headless: true });
  const start = Date.now();
  try {
    const page = await browser.newPage();
    // This really occupies the renderer thread; no route/page.evaluate mock is used.
    await assert.rejects(withEvaluateTimeout(page.evaluate(() => { while (true) { /* hostile renderer */ } }), 250), /页面脚本执行超时/);
  } finally {
    await browser.close();
  }
  assert.ok(Date.now() - start < 5_000, "hung Chromium must be terminated promptly");
  console.log("PASS a real infinite-loop Chromium page times out and the browser closes");
}

(process.argv.includes("worker") ? worker() : main()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
