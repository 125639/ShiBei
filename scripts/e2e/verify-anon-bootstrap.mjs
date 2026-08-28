/**
 * 匿名身份 bootstrap 的真实 HTTP + 双标签页回归。
 *
 * 用法：BASE_URL=http://127.0.0.1:3203 node scripts/e2e/verify-anon-bootstrap.mjs
 * DATABASE_URL / AUTH_SECRET 必须与被测应用一致。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {
  // 调用方已显式传入环境变量时无需本地文件。
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3203").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BOOTSTRAP_PATH = "/api/public/anon/bootstrap";
const DOCS_PATH = "/api/public/writing/docs";
const prisma = new PrismaClient();
let browser;
let context;
let creationContext;
let browserAnonId = "";
let postClearAnonId = "";
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

function bootstrapHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "x-shibei-anon-bootstrap": "1",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    ...extra
  };
}

function isAnonCookieName(name) {
  return /^(?:__Host-)?shibei(?:_dev)?_anon_id$/.test(name);
}

function hasAnonSetCookie(raw) {
  return /(?:^|,\s*)(?:__Host-)?shibei(?:_dev)?_anon_id=/.test(raw || "");
}

function anonCookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(/(?:^|,\s*)((?:__Host-)?shibei(?:_dev)?_anon_id=[^;,]+)/);
  if (!match) throw new Error("response did not set the anonymous identity cookie");
  return match[1];
}

function gate(target, timeoutMs = 30_000) {
  let count = 0;
  let release;
  const opened = new Promise((resolve) => { release = resolve; });
  let timer;
  return {
    async enter() {
      count += 1;
      if (count === 1) timer = setTimeout(() => release(), timeoutMs);
      if (count >= target) {
        if (timer) clearTimeout(timer);
        release();
      }
      await opened;
    },
    count: () => count
  };
}

function timeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readPendingIndexedSeed(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("shibei-anon-bootstrap-v1", 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("bootstrap")) {
        request.result.createObjectStore("bootstrap");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("bootstrap", "readonly");
      const get = transaction.objectStore("bootstrap").get("pending-seed");
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => reject(get.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

try {
  const maliciousSeed = "11111111-1111-4111-8111-111111111111";
  const forged = await fetch(`${BASE}${BOOTSTRAP_PATH}`, {
    method: "POST",
    headers: bootstrapHeaders({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site"
    }),
    body: JSON.stringify({ seed: maliciousSeed })
  });
  assert.equal(forged.status, 403);
  assert.equal(hasAnonSetCookie(forged.headers.get("set-cookie")), false);

  const plain = await fetch(`${BASE}${BOOTSTRAP_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-shibei-anon-bootstrap": "1",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin"
    },
    body: JSON.stringify({ seed: maliciousSeed })
  });
  assert.equal(plain.status, 415);
  assert.equal(hasAnonSetCookie(plain.headers.get("set-cookie")), false);
  pass("跨站固定 seed 与简单 text/plain CSRF 均被拒绝且不写 Cookie");

  const headerlessCreate = await fetch(`${BASE}${DOCS_PATH}`, { method: "POST" });
  assert.equal(headerlessCreate.status, 428);
  assert.equal(hasAnonSetCookie(headerlessCreate.headers.get("set-cookie")), false);
  assert.match((await headerlessCreate.text()), /匿名身份.*重新初始化/);
  pass("无 Cookie 且无合法 seed 的匿名创建 fail closed，不再随机签发孤儿身份");

  const firstSeed = randomUUID();
  const initial = await fetch(`${BASE}${BOOTSTRAP_PATH}`, {
    method: "POST",
    headers: bootstrapHeaders(),
    body: JSON.stringify({ seed: firstSeed })
  });
  assert.equal(initial.status, 200);
  const originalCookie = anonCookieFrom(initial);
  assert.equal(originalCookie.includes(firstSeed), false, "client seed must not become the bearer id");

  const replacement = await fetch(`${BASE}${BOOTSTRAP_PATH}`, {
    method: "POST",
    headers: { ...bootstrapHeaders(), cookie: originalCookie },
    body: JSON.stringify({ seed: randomUUID() })
  });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.headers.get("set-cookie") || "", "");
  assert.equal((await replacement.json()).created, false);
  pass("服务端以 HMAC 派生身份，已有 HttpOnly Cookie 绝不被新 seed 替换");

  // 预热页面和 API 编译，不执行浏览器客户端逻辑，也不创建文档。
  const warmPage = await fetch(`${BASE}/write`);
  assert.equal(warmPage.status, 200);
  const warmList = await fetch(`${BASE}${DOCS_PATH}`);
  assert.equal(warmList.status, 200);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1100, height: 800 } });

  const bootstrapGate = gate(2);
  const bootstrapSeeds = [];
  let interceptedBootstraps = 0;
  let postClearBootstrapGate = null;
  const postClearBootstrapSeeds = [];
  await context.route(`**${BOOTSTRAP_PATH}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const data = route.request().postDataJSON();
    if (interceptedBootstraps < 2) {
      interceptedBootstraps += 1;
      bootstrapSeeds.push(data.seed);
      await bootstrapGate.enter();
    } else if (postClearBootstrapGate && postClearBootstrapSeeds.length < 2) {
      postClearBootstrapSeeds.push(data.seed);
      await postClearBootstrapGate.enter();
    }
    await route.continue();
  });

  // 两个列表请求都先在服务器完成查询，再一起交给客户端；此时任一标签页都
  // 尚未看到空列表并自动 POST，保证精确复现“双空列表 → 双新建”的竞态。
  const listArrivalGate = gate(2);
  const listFetchedGate = gate(2);
  let interceptedLists = 0;
  await context.route(`**${DOCS_PATH}`, async (route) => {
    if (route.request().method() !== "GET" || interceptedLists >= 2) {
      await route.continue();
      return;
    }
    interceptedLists += 1;
    await listArrivalGate.enter();
    const response = await route.fetch();
    await listFetchedGate.enter();
    await route.fulfill({ response });
  });

  const createdIds = [];
  const postClearCreatedIds = [];
  const postClearCreationSeeds = [];
  let recordPostClearCreations = false;
  let createdResolve;
  const twoCreated = new Promise((resolve) => { createdResolve = resolve; });
  let postClearCreatedResolve;
  const twoPostClearCreated = new Promise((resolve) => { postClearCreatedResolve = resolve; });
  context.on("response", async (response) => {
    try {
      const request = response.request();
      if (
        new URL(response.url()).pathname === DOCS_PATH
        && request.method() === "POST"
        && response.status() === 200
      ) {
        const payload = await response.json();
        const id = payload?.doc?.id;
        if (typeof id !== "string") return;
        if (recordPostClearCreations) {
          if (!postClearCreatedIds.includes(id)) {
            postClearCreatedIds.push(id);
            postClearCreationSeeds.push(request.headers()["x-shibei-anon-seed"] || "");
          }
          if (postClearCreatedIds.length >= 2) postClearCreatedResolve();
        } else {
          if (!createdIds.includes(id)) createdIds.push(id);
          if (createdIds.length >= 2) createdResolve();
        }
      }
    } catch {
      // 主断言会报告缺少自动创建结果。
    }
  });

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await Promise.all([
    pageA.goto(`${BASE}/write`, { waitUntil: "domcontentloaded" }),
    pageB.goto(`${BASE}/write`, { waitUntil: "domcontentloaded" })
  ]);
  await timeout(twoCreated, 30_000, "two writing documents");

  assert.equal(bootstrapGate.count(), 2);
  assert.equal(bootstrapSeeds.length, 2);
  assert.equal(bootstrapSeeds[0], bootstrapSeeds[1], "both tabs must submit the same pending seed");
  assert.equal(listArrivalGate.count(), 2);
  assert.equal(createdIds.length >= 2, true);

  const cookies = await context.cookies(BASE);
  const anonCookies = cookies.filter((cookie) => isAnonCookieName(cookie.name));
  assert.equal(anonCookies.length, 1);
  browserAnonId = anonCookies[0].value;

  const rows = await prisma.writingDoc.findMany({
    where: { id: { in: createdIds.slice(0, 2) } },
    select: { id: true, ownerId: true, anonId: true }
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.anonId)), new Set([browserAnonId]));
  assert.equal(rows.every((row) => row.ownerId === null), true);

  const visible = await pageA.evaluate(async () => {
    const response = await fetch("/api/public/writing/docs");
    return response.json();
  });
  for (const id of createdIds.slice(0, 2)) {
    assert.equal(visible.docs.some((doc) => doc.id === id), true);
    for (const page of [pageA, pageB]) {
      const status = await page.evaluate(async (docId) => (
        await fetch(`/api/public/writing/docs/${docId}`)
      ).status, id);
      assert.equal(status, 200);
    }
  }
  assert.equal(await readPendingIndexedSeed(pageA), null);
  pass("两个全新同源标签页并发初始化/自动新建后共享同一 Cookie，两条记录均可见且无孤儿");

  // 关键生命周期回归：两个页面的首次 bootstrap Promise 都已经成功结束，此时
  // 不刷新页面而清除共享 HttpOnly cookie，再同时点击“新建”。成功 Promise 若被
  // 永久缓存，这两个 POST 会各自由服务端随机发身份并制造一条孤儿记录。
  postClearBootstrapGate = gate(2);
  recordPostClearCreations = true;
  await context.clearCookies({ name: anonCookies[0].name });
  assert.equal(
    (await context.cookies(BASE)).some((cookie) => isAnonCookieName(cookie.name)),
    false
  );

  await Promise.all([
    pageA.getByRole("button", { name: "+ 新建", exact: true }).click(),
    pageB.getByRole("button", { name: "+ 新建", exact: true }).click()
  ]);
  await timeout(twoPostClearCreated, 30_000, "two post-clear writing documents");

  assert.equal(postClearBootstrapGate.count(), 2, "每个标签页都必须重新执行 bootstrap");
  assert.equal(postClearBootstrapSeeds.length, 2);
  assert.equal(
    postClearBootstrapSeeds[0],
    postClearBootstrapSeeds[1],
    "清 cookie 后两个标签页仍必须提交同一个 pending seed"
  );
  assert.deepEqual(
    new Set(postClearCreationSeeds),
    new Set([postClearBootstrapSeeds[0]]),
    "每个创建请求必须携带刚完成 bootstrap 的同一 seed"
  );

  const postClearCookies = (await context.cookies(BASE)).filter((cookie) => isAnonCookieName(cookie.name));
  assert.equal(postClearCookies.length, 1);
  postClearAnonId = postClearCookies[0].value;
  assert.notEqual(postClearAnonId, browserAnonId, "清 cookie 后应进入新的、但跨标签一致的匿名身份");

  const postClearRows = await prisma.writingDoc.findMany({
    where: { id: { in: postClearCreatedIds.slice(0, 2) } },
    select: { id: true, ownerId: true, anonId: true }
  });
  assert.equal(postClearRows.length, 2);
  assert.deepEqual(new Set(postClearRows.map((row) => row.anonId)), new Set([postClearAnonId]));
  assert.equal(postClearRows.every((row) => row.ownerId === null), true);

  const postClearVisible = await pageA.evaluate(async () => {
    const response = await fetch("/api/public/writing/docs");
    return response.json();
  });
  for (const id of postClearCreatedIds.slice(0, 2)) {
    assert.equal(postClearVisible.docs.some((doc) => doc.id === id), true);
  }
  assert.equal(await readPendingIndexedSeed(pageA), null);
  pass("不刷新清除 Cookie 后，两标签并发新建会重新 bootstrap；新两条记录同属最终 Cookie 且均可见");

  // CreationStudio 没有自动新建，但其私有作品列表同样必须严格等待 bootstrap。
  creationContext = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  let bootstrapSeen = false;
  let bootstrapReleased = false;
  let worksStartedBeforeBootstrap = false;
  await creationContext.route(`**${BOOTSTRAP_PATH}`, async (route) => {
    bootstrapSeen = true;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    bootstrapReleased = true;
    await route.fulfill({ response });
  });
  let worksResolve;
  const worksRequested = new Promise((resolve) => { worksResolve = resolve; });
  let worksResponseResolve;
  const worksResponded = new Promise((resolve) => { worksResponseResolve = resolve; });
  creationContext.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/public/creation/works"
      && request.method() === "GET"
    ) {
      if (!bootstrapReleased) worksStartedBeforeBootstrap = true;
      worksResolve();
    }
  });
  creationContext.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/public/creation/works"
      && response.request().method() === "GET"
    ) {
      worksResponseResolve(response.status());
    }
  });
  const creationPage = await creationContext.newPage();
  await creationPage.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
  await timeout(worksRequested, 30_000, "CreationStudio works request");
  assert.equal(await timeout(worksResponded, 30_000, "CreationStudio works response"), 200);
  assert.equal(bootstrapSeen, true);
  assert.equal(worksStartedBeforeBootstrap, false);
  pass("CreationStudio 的初始作品列表严格等待 bootstrap 响应完成");

  console.log(`\nAll ${checks} anonymous bootstrap checks passed.`);
} finally {
  await creationContext?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (browserAnonId) {
    await prisma.writingDoc.deleteMany({ where: { anonId: browserAnonId } }).catch(() => undefined);
  }
  if (postClearAnonId) {
    await prisma.writingDoc.deleteMany({ where: { anonId: postClearAnonId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}
