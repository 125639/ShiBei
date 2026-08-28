/**
 * Real-browser pagination regression:
 *   - the 51st private work is discoverable in Account and CreationStudio;
 *   - the 101st writing document is discoverable and editable;
 *   - another member's rows never appear on either cursor chain.
 *
 * Usage: BASE_URL=http://127.0.0.1:3100 node scripts/e2e/verify-private-list-pagination.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const prisma = new PrismaClient();
const stamp = Date.now();
const password = `Pagination!${stamp}Aa`;
const memberEmail = `pagination-a-${stamp}@example.test`;
const otherEmail = `pagination-b-${stamp}@example.test`;
const genreId = `e2e-pagination-genre-${stamp}`;
const genreSlug = `e2e-pagination-${stamp}`;
let memberId = "";
let otherMemberId = "";
let browser;

function pass(message) {
  console.log(`PASS  ${message}`);
}

try {
  const passwordHash = await bcrypt.hash(password, 4);
  const seeded = await prisma.$transaction(async (tx) => {
    const [member, otherMember] = await Promise.all([
      tx.memberUser.create({
        data: { email: memberEmail, passwordHash, credentialState: "ACTIVE" }
      }),
      tx.memberUser.create({
        data: { email: otherEmail, passwordHash, credentialState: "ACTIVE" }
      })
    ]);
    await tx.creationGenre.create({
      data: {
        id: genreId,
        slug: genreSlug,
        name: "分页验收题材",
        description: "仅用于分页浏览器回归",
        dimensions: JSON.stringify([{ key: "clarity", label: "清晰", weight: 1, hint: "表达清晰" }]),
        threshold: 60,
        sortOrder: 9999,
        isEnabled: true
      }
    });

    const baseTime = Date.parse("2026-07-13T12:00:00.000Z");
    await tx.creativeWork.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        ownerId: member.id,
        anonId: null,
        genreId,
        mode: "MANUAL",
        depth: "SHORT",
        status: "DRAFT",
        topic: `分页作品 ${String(index + 1).padStart(3, "0")}`,
        title: `分页作品 ${String(index + 1).padStart(3, "0")}`,
        summary: `第 ${index + 1} 个分页作品`,
        content: `这是第 ${index + 1} 个分页作品的正文。`,
        interview: "[]",
        updatedAt: new Date(baseTime - index * 1_000)
      }))
    });
    await tx.writingDoc.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        ownerId: member.id,
        anonId: null,
        title: `分页文档 ${String(index + 1).padStart(3, "0")}`,
        content: `这是第 ${index + 1} 个分页文档的正文。`,
        updatedAt: new Date(baseTime - index * 1_000)
      }))
    });
    await tx.creativeWork.create({
      data: {
        ownerId: otherMember.id,
        anonId: null,
        genreId,
        mode: "MANUAL",
        depth: "SHORT",
        status: "DRAFT",
        topic: "其他会员的隐藏作品",
        title: "其他会员的隐藏作品",
        summary: "绝不能出现在 A 的列表",
        content: "其他会员私有正文",
        interview: "[]",
        updatedAt: new Date(baseTime + 60_000)
      }
    });
    await tx.writingDoc.create({
      data: {
        ownerId: otherMember.id,
        anonId: null,
        title: "其他会员的隐藏文档",
        content: "绝不能出现在 A 的写作台",
        updatedAt: new Date(baseTime + 60_000)
      }
    });
    return { member, otherMember };
  });
  memberId = seeded.member.id;
  otherMemberId = seeded.otherMember.id;

  const oldestWork = await prisma.creativeWork.findFirstOrThrow({
    where: { ownerId: memberId, title: "分页作品 051" },
    select: { id: true }
  });
  const oldestDoc = await prisma.writingDoc.findFirstOrThrow({
    where: { ownerId: memberId, title: "分页文档 101" },
    select: { id: true }
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25_000);

  await page.goto(`${BASE}/account`, { waitUntil: "domcontentloaded" });
  await page.fill("#member-account", memberEmail);
  await page.fill("#member-secret", password);
  await page.locator("form", { has: page.locator("#member-account") }).getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "我的账户" }).waitFor({ state: "visible" });

  assert.equal(await page.getByText("分页作品 051", { exact: true }).count(), 0);
  await page.getByTestId("account-load-more-works").click();
  const accountOldWork = page.locator(".creation-work-list li", { hasText: "分页作品 051" });
  await accountOldWork.waitFor({ state: "visible" });
  assert.equal(await page.getByText("其他会员的隐藏作品", { exact: true }).count(), 0);
  await accountOldWork.getByRole("link", { name: "继续" }).click();
  await page.waitForURL(`${BASE}/create?work=${oldestWork.id}`);
  await page.locator("#creation-title").waitFor({ state: "visible" });
  assert.equal(await page.locator("#creation-title").inputValue(), "分页作品 051");
  pass("账户页可加载并继续打开第 51 个私有作品");

  await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("creation-load-more").waitFor({ state: "visible" });
  assert.equal(await page.getByText("分页作品 051", { exact: true }).count(), 0);
  await page.getByTestId("creation-load-more").click();
  const studioOldWork = page.locator(".creation-work-list li", { hasText: "分页作品 051" });
  await studioOldWork.waitFor({ state: "visible" });
  assert.equal(await page.getByText("其他会员的隐藏作品", { exact: true }).count(), 0);
  await studioOldWork.locator("button.creation-work-item").click();
  await page.locator("#creation-title").waitFor({ state: "visible" });
  await page.fill("#creation-title", "分页作品 051（已操作）");
  const workSave = page.waitForResponse((response) =>
    response.url().endsWith(`/api/public/creation/works/${oldestWork.id}`)
    && response.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  assert.equal((await workSave).status(), 200);
  pass("共创工作室可加载、打开并保存第 51 个私有作品");

  await page.goto(`${BASE}/write?mode=manual`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("writing-load-more-docs").waitFor({ state: "visible" });
  assert.equal(await page.getByText("分页文档 101", { exact: true }).count(), 0);
  await page.getByTestId("writing-load-more-docs").click();
  const oldDocButton = page.locator("button.writing-doc-item", { hasText: "分页文档 101" });
  await oldDocButton.waitFor({ state: "visible" });
  assert.equal(await page.getByText("其他会员的隐藏文档", { exact: true }).count(), 0);
  await oldDocButton.click();
  await page.locator(".notion-editor .tiptap", { hasText: "第 101 个分页文档" }).waitFor({ state: "visible" });
  const docSave = page.waitForResponse((response) =>
    response.url().endsWith(`/api/public/writing/docs/${oldestDoc.id}`)
    && response.request().method() === "PATCH"
  );
  await page.fill(".writing-title", "分页文档 101（已操作）");
  assert.equal((await docSave).status(), 200);
  assert.equal(
    (await prisma.writingDoc.findUniqueOrThrow({ where: { id: oldestDoc.id }, select: { title: true } })).title,
    "分页文档 101（已操作）"
  );
  pass("写作台可加载、打开并保存第 101 个私有文档");

  console.log("All private-list pagination browser checks passed.");
} finally {
  await browser?.close().catch(() => undefined);
  if (memberId || otherMemberId) {
    await prisma.memberUser.deleteMany({
      where: { id: { in: [memberId, otherMemberId].filter(Boolean) } }
    }).catch(() => undefined);
  }
  await prisma.creationGenre.deleteMany({ where: { id: genreId } }).catch(() => undefined);
  await prisma.$disconnect();
}
