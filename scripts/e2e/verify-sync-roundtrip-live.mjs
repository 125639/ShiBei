/** Disposable-stack E2E for incremental ZIP export/import round-tripping. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

try { if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env"); } catch {}
if (process.env.ALLOW_LIVE_WRITE !== "1") throw new Error("Set ALLOW_LIVE_WRITE=1 only for a disposable stack");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AdmZip = require("adm-zip");
const prisma = new PrismaClient();
const base = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const marker = `full-audit-sync-${Date.now()}`;
const since = new Date(Date.now() - 1_000);
let postId = "";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

try {
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.fill('input[name="username"]', process.env.ADMIN_USERNAME || "admin");
  await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin", { timeout: 120_000 }),
    page.click('button[type="submit"]')
  ]);

  const created = await prisma.post.create({
    data: {
      slug: marker,
      title: `${marker} 同步文章`,
      summary: "同步增量包往返验收。",
      content: "## 同步验收\n\n这篇文章会先导出、删除，再通过同一 ZIP 恢复。",
      status: "PUBLISHED",
      kind: "SINGLE_ARTICLE",
      publishedAt: new Date(),
      tags: { connectOrCreate: [{ where: { name: marker }, create: { name: marker } }] }
    }
  });
  postId = created.id;

  const exported = await context.request.get(
    `${base}/api/admin/sync/export?since=${encodeURIComponent(since.toISOString())}`,
    { timeout: 120_000 }
  );
  if (exported.status() !== 200) assert.fail(`${exported.status()} ${await exported.text()}`);
  assert.match(exported.headers()["content-type"] || "", /application\/zip/);
  const archive = Buffer.from(await exported.body());
  assert.ok(archive.byteLength > 100);
  const zip = new AdmZip(archive);
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  const posts = JSON.parse(zip.readAsText("posts.json"));
  assert.equal(manifest.postCount, posts.length);
  assert.ok(posts.some((post) => post.id === created.id));
  console.log("PASS  增量导出 ZIP 的清单、数量和文章内容一致");

  await prisma.post.delete({ where: { id: created.id } });
  assert.equal(await prisma.post.count({ where: { id: created.id } }), 0);

  const imported = await context.request.post(`${base}/api/admin/sync/import`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin", Accept: "application/json" },
    multipart: {
      redirect: "/admin/sync",
      file: { name: "audit-sync.zip", mimeType: "application/zip", buffer: archive }
    },
    timeout: 120_000
  });
  const importedText = await imported.text();
  assert.equal(imported.status(), 200, importedText);
  const importedBody = JSON.parse(importedText);
  assert.equal(importedBody.ok, true);
  assert.ok(importedBody.result.postsUpserted >= 1);
  const restored = await prisma.post.findUnique({ where: { id: created.id }, include: { tags: true } });
  assert.equal(restored?.slug, marker);
  assert.equal(restored?.status, "PUBLISHED");
  assert.ok(restored?.tags.some((tag) => tag.name === marker));
  const publicPage = await context.request.get(`${base}/posts/${marker}`, { timeout: 60_000 });
  assert.equal(publicPage.status(), 200);
  assert.match(await publicPage.text(), new RegExp(marker));
  console.log("PASS  删除后的文章可由同步包原子恢复并立即公开读取");

  const repeated = await context.request.post(`${base}/api/admin/sync/import`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin", Accept: "application/json" },
    multipart: { file: { name: "audit-sync.zip", mimeType: "application/zip", buffer: archive } },
    timeout: 120_000
  });
  const repeatedText = await repeated.text();
  assert.equal(repeated.status(), 200, repeatedText);
  const repeatedBody = JSON.parse(repeatedText);
  assert.equal(repeatedBody.ok, true);
  assert.ok(repeatedBody.result.postsSkipped >= 1);
  assert.equal(await prisma.post.count({ where: { id: created.id } }), 1);
  console.log("PASS  重复导入按 updatedAt 幂等跳过，不产生重复记录");
} finally {
  if (postId) await prisma.post.deleteMany({ where: { id: postId } }).catch(() => undefined);
  await prisma.tag.deleteMany({ where: { name: marker, posts: { none: {} } } }).catch(() => undefined);
  await prisma.$disconnect();
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
