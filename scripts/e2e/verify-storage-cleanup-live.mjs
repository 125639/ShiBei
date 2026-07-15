/**
 * Real manual-cleanup drill against an isolated database/app instance.
 * It creates one deliberately ancient post plus local video, verifies the
 * confirmation guard, executes cleanup, checks the result banner, then removes
 * all database test rows and restores retention settings.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { cookieHeaderForAuthValue } from "./auth-cookie-names.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const secret = process.env.AUTH_SECRET;
assert.ok(secret, "AUTH_SECRET is required");
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const filename = `storage-cleanup-${suffix}.mp4`;
const relativePath = `/uploads/video/${filename}`;
const absolutePath = path.join(process.cwd(), "public", "uploads", "video", filename);
let postId = "";
let videoId = "";
let originalRetention = 30;

function pass(message) {
  console.log(`PASS  ${message}`);
}

try {
  const [admin, settings] = await Promise.all([
    prisma.adminUser.findFirst({ select: { id: true, tokenVersion: true } }),
    prisma.siteSettings.findUniqueOrThrow({
      where: { id: "site" },
      select: { cleanupAfterDays: true }
    })
  ]);
  assert.ok(admin, "isolated database has no admin user");
  originalRetention = settings.cleanupAfterDays;

  const cutoff = new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000);
  const [oldPublished, oldJobs, oldRawItems, oldArchivedVideos] = await Promise.all([
    prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { lt: cutoff } } }),
    prisma.fetchJob.count({
      where: { status: "COMPLETED", completedAt: { lt: cutoff }, adminAiBatchId: null }
    }),
    prisma.rawItem.count({ where: { createdAt: { lt: cutoff }, post: null } }),
    prisma.video.count({
      where: { localPath: { not: null }, post: { status: "ARCHIVED", publishedAt: { lt: cutoff } } }
    })
  ]);
  assert.deepEqual(
    { oldPublished, oldJobs, oldRawItems, oldArchivedVideos },
    { oldPublished: 0, oldJobs: 0, oldRawItems: 0, oldArchivedVideos: 0 },
    "isolated clone contains unrelated records old enough for this destructive drill"
  );

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, "isolated storage cleanup fixture\n", { flag: "wx" });
  const post = await prisma.post.create({
    data: {
      slug: `storage-cleanup-${suffix}`,
      title: "Storage cleanup isolated fixture",
      summary: "isolated fixture",
      content: "isolated fixture",
      status: "PUBLISHED",
      publishedAt: new Date("2010-01-01T00:00:00.000Z")
    }
  });
  postId = post.id;
  const video = await prisma.video.create({
    data: {
      title: "Storage cleanup isolated video",
      type: "LOCAL",
      url: "https://example.com/isolated-storage-cleanup",
      summary: "isolated fixture",
      localPath: relativePath,
      fileSizeBytes: 33,
      postId
    }
  });
  videoId = video.id;
  await prisma.siteSettings.update({ where: { id: "site" }, data: { cleanupAfterDays: 3650 } });

  const token = await new SignJWT({ userId: admin.id, ver: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(secret));
  const commonHeaders = {
    Origin: BASE,
    Cookie: cookieHeaderForAuthValue("adminSession", token),
    "Content-Type": "application/x-www-form-urlencoded"
  };

  const denied = await fetch(`${BASE}/api/admin/storage/cleanup`, {
    method: "POST",
    headers: commonHeaders,
    body: new URLSearchParams({ confirmation: "yes" }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000)
  });
  assert.equal(denied.status, 400);
  assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).status, "PUBLISHED");
  await fs.access(absolutePath);
  pass("缺少精确确认令牌时返回 400，数据库和文件均未变化");

  const cleaned = await fetch(`${BASE}/api/admin/storage/cleanup`, {
    method: "POST",
    headers: commonHeaders,
    body: new URLSearchParams({ confirmation: "archive-old-posts-and-delete-local-videos" }),
    redirect: "manual",
    signal: AbortSignal.timeout(60_000)
  });
  assert.equal(cleaned.status, 303);
  const location = cleaned.headers.get("location") || "";
  assert.match(location, /cleanup=success/);
  assert.match(location, /posts=1/);
  assert.match(location, /videos=1/);
  const [archived, trimmed] = await Promise.all([
    prisma.post.findUniqueOrThrow({ where: { id: postId } }),
    prisma.video.findUniqueOrThrow({ where: { id: videoId } })
  ]);
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(trimmed.localPath, null);
  await assert.rejects(fs.access(absolutePath));
  pass("确认后仅归档命中的旧文章，并删除/解绑对应本地视频");

  const resultPage = await fetch(new URL(location, BASE), {
    headers: { Cookie: commonHeaders.Cookie },
    signal: AbortSignal.timeout(60_000)
  });
  const html = await resultPage.text();
  assert.equal(resultPage.status, 200);
  assert.match(html, /清理完成/);
  assert.match(html, /归档 1 篇旧文章/);
  pass("管理员返回存储页后可看到准确的清理结果，而不是无反馈跳转");
} finally {
  if (videoId) await prisma.video.deleteMany({ where: { id: videoId } }).catch(() => undefined);
  if (postId) await prisma.post.deleteMany({ where: { id: postId } }).catch(() => undefined);
  await prisma.siteSettings.update({
    where: { id: "site" },
    data: { cleanupAfterDays: originalRetention }
  }).catch(() => undefined);
  await fs.rm(absolutePath, { force: true }).catch(() => undefined);
  await prisma.$disconnect();
}
