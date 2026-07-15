/**
 * Production E2E for the bounded AI audit/repair/publish workflow.
 *
 * This script mutates the selected draft and may publish it. POST_ID is
 * deliberately required and has no default, so merely invoking the file
 * cannot enqueue work for a production article by accident.
 *
 * Usage:
 *   POST_ID=cm... ADMIN_PASSWORD=... \
 *     node scripts/e2e/run-post-repair-live.mjs
 *
 * Required:
 *   BASE_URL=https://example.com
 *
 * Optional:
 *   ADMIN_USERNAME=admin
 *   POST_REPAIR_MAX_WAIT_MS=1800000
 *   POST_REPAIR_POLL_MS=5000
 */
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
const POST_ID = (process.env.POST_ID || process.argv[2] || "").trim();
const MAX_WAIT_MS = readPositiveInteger("POST_REPAIR_MAX_WAIT_MS", 30 * 60 * 1000, 60_000);
const POLL_MS = readPositiveInteger("POST_REPAIR_POLL_MS", 5_000, 1_000);

if (process.env.ALLOW_LIVE_WRITE !== "1") {
  throw new Error("Refusing to mutate or publish a draft: set ALLOW_LIVE_WRITE=1 after verifying BASE_URL and POST_ID");
}
if (!BASE) throw new Error("BASE_URL is required");
if (!PASSWORD) throw new Error("ADMIN_PASSWORD is required");
if (!/^[A-Za-z0-9_-]{1,120}$/.test(POST_ID)) {
  throw new Error("A valid POST_ID is required (environment variable or first argument); no repair was submitted");
}

function readPositiveInteger(name, fallback, minimum) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertRepairResult(result) {
  assert.ok(result && typeof result === "object", "repair result is missing");
  assert.equal(result.postId, POST_ID, `unexpected post id: ${JSON.stringify(result)}`);
  assert.ok(["QUEUED", "RUNNING", "PUBLISHED", "FAILED"].includes(result.state), JSON.stringify(result));
  assert.ok(Number.isInteger(result.attempts) && result.attempts >= 0, JSON.stringify(result));
  assert.ok(Number.isInteger(result.maxAttempts) && result.maxAttempts > 0, JSON.stringify(result));
  assert.ok(result.attempts <= result.maxAttempts, JSON.stringify(result));
  assert.ok(Array.isArray(result.rounds), JSON.stringify(result));
  assert.ok(result.rounds.length <= result.maxAttempts, JSON.stringify(result));
  for (const [index, round] of result.rounds.entries()) {
    assert.ok(Number.isInteger(round.round) && round.round >= 1, JSON.stringify(round));
    assert.ok(["audit", "regenerate", "repair"].includes(round.action), JSON.stringify(round));
    assert.ok(typeof round.reason === "string" && round.reason.trim(), JSON.stringify(round));
    if (index > 0) assert.ok(round.round > result.rounds[index - 1].round, JSON.stringify(result.rounds));
  }
}

async function login(page) {
  const response = await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `admin login returned HTTP ${response?.status()}`);
  await page.fill('input[name="username"]', USERNAME);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.click('button[type="submit"]')
  ]);
  console.log(`LOGIN ok base=${BASE}`);
}

async function readAdminPostStatus(page) {
  const response = await page.goto(`${BASE}/admin/posts/${POST_ID}?repairE2E=${Date.now()}`, {
    waitUntil: "domcontentloaded"
  });
  assert.equal(response?.status(), 200, `admin post page returned HTTP ${response?.status()}`);
  const badge = page.locator(".admin-post-publish-card .tag").first();
  await badge.waitFor({ state: "visible" });
  return (await badge.textContent() || "").trim();
}

async function submitRepair(page) {
  const response = await page.evaluate(async (postId) => {
    const result = await fetch("/api/admin/posts/bulk-repair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postIds: [postId] })
    });
    const text = await result.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { status: result.status, payload };
  }, POST_ID);

  assert.equal(response.status, 202, `repair submission failed: ${JSON.stringify(response.payload)}`);
  assert.equal(response.payload?.accepted, true, JSON.stringify(response.payload));
  assert.ok(typeof response.payload?.batchId === "string" && response.payload.batchId, JSON.stringify(response.payload));
  assert.equal(response.payload?.jobs?.length, 1, JSON.stringify(response.payload));
  assert.equal(response.payload.jobs[0]?.postId, POST_ID, JSON.stringify(response.payload));
  console.log(`START batch=${response.payload.batchId} job=${response.payload.jobs[0].jobId} post=${POST_ID}`);
  return response.payload.batchId;
}

async function readBatch(page, batchId) {
  return page.evaluate(async (id) => {
    const result = await fetch(`/api/admin/posts/bulk-repair?batchId=${encodeURIComponent(id)}`, {
      cache: "no-store"
    });
    const text = await result.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { status: result.status, payload };
  }, batchId);
}

function reportSnapshot(result, reportedRounds, previousState) {
  if (result.state !== previousState) {
    console.log(`STATE ${result.state} attempts=${result.attempts}/${result.maxAttempts} message=${result.message || ""}`);
  }
  for (const round of result.rounds) {
    const fingerprint = `${round.round}\0${round.action}\0${round.reason}`;
    if (reportedRounds.has(fingerprint)) continue;
    reportedRounds.add(fingerprint);
    console.log(`ROUND ${round.round}/${result.maxAttempts} action=${round.action} review=${round.reason}`);
  }
}

async function waitForTerminal(page, batchId) {
  const startedAt = Date.now();
  const reportedRounds = new Set();
  let previousState = "";
  let lastPayload = null;

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const response = await readBatch(page, batchId);
    assert.equal(response.status, 200, `progress request failed: ${JSON.stringify(response.payload)}`);
    const batch = response.payload;
    assert.equal(batch?.batchId, batchId, JSON.stringify(batch));
    assert.equal(batch?.total, 1, JSON.stringify(batch));
    assert.equal(batch?.results?.length, 1, JSON.stringify(batch));
    const result = batch.results[0];
    assertRepairResult(result);
    reportSnapshot(result, reportedRounds, previousState);
    previousState = result.state;
    lastPayload = batch;

    if (batch.complete) {
      assert.ok(["PUBLISHED", "FAILED"].includes(result.state), JSON.stringify(batch));
      assert.ok(["COMPLETED", "FAILED"].includes(result.jobStatus), JSON.stringify(batch));
      console.log(`TERMINAL completed=${batch.completed}/${batch.total} published=${batch.published} failed=${batch.failed}`);
      return result;
    }

    console.log(`HEARTBEAT state=${result.state} updatedAt=${result.updatedAt}`);
    await sleep(POLL_MS);
  }

  throw new Error(`Timed out after ${MAX_WAIT_MS}ms; last payload=${JSON.stringify(lastPayload)}`);
}

async function verifyPublished(page, browser, result) {
  assert.equal(result.reason, null, JSON.stringify(result));
  assert.equal(result.guidance, null, JSON.stringify(result));
  assert.equal(await readAdminPostStatus(page), "PUBLISHED", "database-backed admin page did not show PUBLISHED");

  const publicHref = await page
    .locator('.admin-post-edit-header a[href^="/posts/"]')
    .first()
    .getAttribute("href");
  assert.match(publicHref || "", /^\/posts\/[^/?#]+$/, "published article link is missing from admin page");

  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const publicPage = await anonymous.newPage();
    publicPage.setDefaultTimeout(90_000);
    const response = await publicPage.goto(`${BASE}${publicHref}`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `anonymous public page returned HTTP ${response?.status()}`);
    // innerText reflects the active language only; textContent would concatenate
    // the visible and CSS-hidden i18n spans and make a healthy heading look doubled.
    const heading = (await publicPage.locator("main h1").first().innerText() || "").trim();
    assert.ok(heading, "anonymous public article has no heading");
    console.log(`VERIFY PUBLISHED admin=PUBLISHED public=${publicHref} http=200 heading=${heading}`);
  } finally {
    await anonymous.close();
  }
}

async function verifyFailed(page, result) {
  assert.ok(typeof result.reason === "string" && result.reason.trim(), "failed repair must expose an exact reason");
  assert.ok(typeof result.guidance === "string" && result.guidance.trim(), "failed repair must expose actionable guidance");
  assert.equal(await readAdminPostStatus(page), "DRAFT", "failed repair changed the article out of DRAFT");
  console.log(`FINAL_REASON ${result.reason}`);
  console.log(`GUIDANCE ${result.guidance}`);
  console.log("VERIFY FAILED admin=DRAFT original draft retained");
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  await login(page);

  const initialStatus = await readAdminPostStatus(page);
  assert.equal(initialStatus, "DRAFT", `AI repair only accepts DRAFT posts; current status=${initialStatus}`);
  console.log(`PRECHECK post=${POST_ID} status=DRAFT`);

  const batchId = await submitRepair(page);
  const result = await waitForTerminal(page, batchId);
  if (result.state === "PUBLISHED") {
    await verifyPublished(page, browser, result);
  } else {
    await verifyFailed(page, result);
  }

  console.log(`PASS post-repair production E2E state=${result.state} attempts=${result.attempts}/${result.maxAttempts}`);
  await context.close();
} finally {
  await browser.close();
}
