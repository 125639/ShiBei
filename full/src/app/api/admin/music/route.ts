import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { MUSIC_DIR, ensureUploadDirs } from "@/lib/storage";
import { resolveUploadsPath } from "@/lib/uploads-path";

export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav"]);
const MAX_BYTES = 30 * 1024 * 1024; // 30MB per track

export async function POST(request: Request) {
  await requireAdmin();
  await ensureUploadDirs();
  const form = await request.formData();
  const file = form.get("file");
  const title = String(form.get("title") || "").trim();
  const artist = String(form.get("artist") || "").trim() || null;
  const sortOrder = Number(form.get("sortOrder") || 0);

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "未选择文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `文件过大（>${MAX_BYTES / 1024 / 1024}MB）` }, { status: 400 });
  }

  const originalName = file.name || "track.mp3";
  const ext = path.extname(originalName).toLowerCase() || ".mp3";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: `不支持的格式：${ext}` }, { status: 400 });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const fileName = `${id}${ext}`;
  const abs = path.join(MUSIC_DIR, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(abs, buffer);

  const filePath = `/uploads/music/${fileName}`;
  const finalTitle = title || originalName.replace(/\.[^.]+$/, "");

  await (prisma as unknown as {
    music: { create: (args: unknown) => Promise<unknown> };
  }).music.create({
    data: {
      title: finalTitle,
      artist,
      filePath,
      fileSizeBytes: buffer.length,
      sortOrder: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
      isEnabled: true
    }
  });

  return redirectTo("/admin/music");
}

export async function DELETE(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const track = await (prisma as unknown as {
    music: {
      findUnique: (args: unknown) => Promise<{ filePath: string } | null>;
      delete: (args: unknown) => Promise<unknown>;
    };
  }).music.findUnique({ where: { id } });
  if (!track) return NextResponse.json({ ok: true });

  if (track.filePath) {
    const abs = resolveUploadsPath(track.filePath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  await (prisma as unknown as {
    music: { delete: (args: unknown) => Promise<unknown> };
  }).music.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
