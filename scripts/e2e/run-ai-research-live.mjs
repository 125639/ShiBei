import assert from "node:assert/strict";
import { createRequire } from "node:module";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
const USERNAME = process.env.ADMIN_USERNAME || "admin";
const PASSWORD = process.env.ADMIN_PASSWORD;
const KEYWORD = process.env.RESEARCH_KEYWORD || "韩国股市 估值 风险 外资流向 2026 下半年 预测";
const MAX_WAIT_MS = Number(process.env.RESEARCH_MAX_WAIT_MS || 20 * 60 * 1000);
const RETRY_JOB_ID = (process.env.RESEARCH_RETRY_JOB_ID || "").trim();
const EXPECTED_STATUS = (process.env.EXPECT_RESEARCH_STATUS || "").trim();

if (process.env.ALLOW_LIVE_WRITE !== "1") {
  throw new Error("Refusing to create research jobs: set ALLOW_LIVE_WRITE=1 after verifying BASE_URL points at the intended environment");
}
if (!BASE) throw new Error("BASE_URL is required");
if (!PASSWORD) throw new Error("ADMIN_PASSWORD is required");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);

  async function login() {
    await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="username"]', USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin"),
      page.click('button[type="submit"]')
    ]);
  }

  await login();

  let jobId;
  if (RETRY_JOB_ID) {
    assert.match(RETRY_JOB_ID, /^[A-Za-z0-9_-]{1,120}$/);
    const retried = await page.evaluate(async (targetJobId) => {
      const response = await fetch("/api/admin/ai-admin/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: targetJobId })
      });
      return { status: response.status, payload: await response.json() };
    }, RETRY_JOB_ID);
    assert.ok([200, 202].includes(retried.status), JSON.stringify(retried.payload));
    assert.equal(retried.payload.ok, true, JSON.stringify(retried.payload));
    jobId = RETRY_JOB_ID;
    console.log(`RETRY job=${jobId}`);
  } else {
    const execution = await page.evaluate(async (keyword) => {
      const response = await fetch("/api/admin/ai-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          request: `生产回归验证：${keyword}`,
          scope: "international",
          depth: "long",
          articleCount: 1,
          tasks: [{
            keyword,
            reason: "验证真实采集、证据筛选、模型生成与发布门禁全流程",
            scope: "international",
            depth: "long",
            articleCount: 1,
            topicId: null,
            styleId: null
          }],
          recurring: []
        })
      });
      return { status: response.status, payload: await response.json() };
    }, KEYWORD);

    assert.equal(execution.status, 200, JSON.stringify(execution.payload));
    assert.equal(execution.payload.executed, true, JSON.stringify(execution.payload));
    jobId = execution.payload.tasks?.[0]?.jobId;
    assert.ok(jobId, JSON.stringify(execution.payload));
    console.log(`START batch=${execution.payload.batchId} job=${jobId}`);
  }

  const startedAt = Date.now();
  let lastStatus = "";
  let terminalSnapshot = null;
  let transientPollFailures = 0;
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const polled = await page.evaluate(async (targetJobId) => {
      try {
        const response = await fetch("/api/admin/ai-admin", { cache: "no-store" });
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          return {
            ok: false,
            status: response.status,
            url: response.url,
            error: `non-JSON response: ${text.slice(0, 120)}`
          };
        }
        if (!response.ok) {
          return { ok: false, status: response.status, url: response.url, error: payload?.error || "admin API failed" };
        }
        const jobs = payload.batches?.flatMap((batch) => batch.jobs || []) || [];
        return { ok: true, snapshot: jobs.find((job) => job.id === targetJobId) || null };
      } catch (error) {
        return { ok: false, status: 0, url: "", error: error instanceof Error ? error.message : String(error) };
      }
    }, jobId);
    if (!polled.ok) {
      transientPollFailures += 1;
      console.log(`POLL_RETRY ${transientPollFailures} status=${polled.status} url=${polled.url} error=${polled.error}`);
      if (String(polled.url || "").includes("/admin/login")) await login();
      if (transientPollFailures >= 8) throw new Error(`Admin polling failed ${transientPollFailures} consecutive times: ${polled.error}`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    transientPollFailures = 0;
    const snapshot = polled.snapshot;
    assert.ok(snapshot, `job ${jobId} disappeared from admin API`);
    if (snapshot.status !== lastStatus) {
      console.log(`STATUS ${snapshot.status}${snapshot.error ? ` error=${snapshot.error}` : ""}`);
      lastStatus = snapshot.status;
    } else {
      console.log(`HEARTBEAT ${snapshot.status} updatedAt=${snapshot.updatedAt}`);
    }
    if (snapshot.status === "COMPLETED" || snapshot.status === "FAILED") {
      console.log(`FINAL ${JSON.stringify({ jobId, ...snapshot })}`);
      terminalSnapshot = snapshot;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }

  if (!lastStatus || (lastStatus !== "COMPLETED" && lastStatus !== "FAILED")) {
    throw new Error(`Timed out waiting for ${jobId}; last status=${lastStatus || "unknown"}`);
  }
  if (EXPECTED_STATUS) {
    assert.ok(["COMPLETED", "FAILED"].includes(EXPECTED_STATUS), "EXPECT_RESEARCH_STATUS must be COMPLETED or FAILED");
    assert.equal(terminalSnapshot?.status, EXPECTED_STATUS, JSON.stringify(terminalSnapshot));
  }
} finally {
  await browser.close();
}
