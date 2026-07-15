/** Disposable-stack E2E for real music/video multipart uploads and cleanup. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

try { if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env"); } catch {}

if (process.env.ALLOW_LIVE_WRITE !== "1") {
  throw new Error("Set ALLOW_LIVE_WRITE=1 only for a disposable database/uploads stack");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const prisma = new PrismaClient();
const base = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const marker = `full-audit-media-${Date.now()}`;
const created = { musicId: null, videoId: null };
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', process.env.ADMIN_USERNAME || "admin");
  await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.click('button[type="submit"]')
  ]);

  const invalid = await upload(page, "/api/admin/music", {
    title: `${marker}-invalid`,
    fileName: "renamed.mp3",
    type: "audio/mpeg",
    bytes: [...Buffer.from("<script>not audio</script>")]
  });
  assert.equal(invalid.status, 400, JSON.stringify(invalid));
  assert.match(invalid.text, /不匹配/);
  assert.equal(await prisma.music.count({ where: { title: `${marker}-invalid` } }), 0);
  console.log("PASS  renamed non-audio payload is rejected before disk/DB persistence");

  const wavHeader = Buffer.concat([
    Buffer.from("RIFF", "ascii"), Buffer.from([36, 0, 0, 0]),
    Buffer.from("WAVEfmt ", "ascii"), Buffer.alloc(24)
  ]);
  const musicUpload = await upload(page, "/api/admin/music", {
    title: `${marker}-music`, fileName: "audit.wav", type: "audio/wav", bytes: [...wavHeader]
  });
  assert.ok([200, 303].includes(musicUpload.status), JSON.stringify(musicUpload));
  const music = await prisma.music.findFirst({ where: { title: `${marker}-music` } });
  assert.ok(music);
  created.musicId = music.id;
  assert.equal((await page.request.get(`${base}${music.filePath}`)).status(), 200);
  const musicDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/admin/music?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return { status: response.status, body: await response.text() };
  }, music.id);
  assert.equal(musicDelete.status, 200, JSON.stringify(musicDelete));
  created.musicId = null;
  assert.equal(await prisma.music.count({ where: { id: music.id } }), 0);
  assert.equal((await page.request.get(`${base}${music.filePath}`)).status(), 404);
  console.log("PASS  valid WAV upload is served, then metadata and file are both deleted");

  const invalidVideo = await upload(page, "/api/admin/videos", {
    title: `${marker}-invalid-video`, fileName: "renamed.mp4", type: "video/mp4",
    bytes: [...Buffer.from("this is not an mp4")]
  });
  assert.equal(invalidVideo.status, 400, JSON.stringify(invalidVideo));
  assert.match(invalidVideo.text, /不匹配/);
  assert.equal(await prisma.video.count({ where: { title: `${marker}-invalid-video` } }), 0);
  console.log("PASS  renamed non-video payload is rejected before disk/DB persistence");

  const mp4Header = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom00000000", "ascii")]);
  const videoUpload = await upload(page, "/api/admin/videos", {
    title: `${marker}-video`, fileName: "audit.mp4", type: "video/mp4", bytes: [...mp4Header]
  });
  assert.ok([200, 303].includes(videoUpload.status), JSON.stringify(videoUpload));
  const video = await prisma.video.findFirst({ where: { title: `${marker}-video` } });
  assert.ok(video?.localPath);
  created.videoId = video.id;
  assert.equal((await page.request.get(`${base}${video.localPath}`)).status(), 200);
  const videoDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/admin/videos/delete?id=${encodeURIComponent(id)}`, { method: "POST" });
    return { status: response.status, body: await response.text() };
  }, video.id);
  assert.ok([200, 303].includes(videoDelete.status), JSON.stringify(videoDelete));
  created.videoId = null;
  assert.equal(await prisma.video.count({ where: { id: video.id } }), 0);
  assert.equal((await page.request.get(`${base}${video.localPath}`)).status(), 404);
  console.log("PASS  valid MP4 upload is served, then metadata and file are both deleted");
} finally {
  if (created.musicId) await prisma.music.deleteMany({ where: { id: created.musicId } }).catch(() => undefined);
  if (created.videoId) await prisma.video.deleteMany({ where: { id: created.videoId } }).catch(() => undefined);
  await prisma.music.deleteMany({ where: { title: { startsWith: marker } } }).catch(() => undefined);
  await prisma.video.deleteMany({ where: { title: { startsWith: marker } } }).catch(() => undefined);
  await prisma.$disconnect();
  await browser.close();
}

async function upload(page, endpoint, input) {
  return page.evaluate(async ({ endpoint, input }) => {
    const form = new FormData();
    form.set("title", input.title);
    form.set("file", new File([new Uint8Array(input.bytes)], input.fileName, { type: input.type }));
    // Browser fetch exposes same-origin redirects as an opaque response with
    // status 0 when redirect:"manual" is used. Follow the redirect so this
    // exercise asserts the actual completed form flow instead.
    const response = await fetch(endpoint, { method: "POST", body: form, redirect: "follow" });
    return { status: response.status, text: await response.text() };
  }, { endpoint, input });
}
