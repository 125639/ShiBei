import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { MUSIC_DIR, ensureUploadDirs } from "@/lib/storage";
import { writeUploadedFile } from "@/lib/upload-stream";
import { uploadedMediaSignatureProblem } from "@/lib/upload-signatures";
import { resolveUploadsPath } from "@/lib/uploads-path";

export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav"]);
const MAX_BYTES = 30 * 1024 * 1024; // 30MB per track

export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
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
  const signatureProblem = await uploadedMediaSignatureProblem(file, ext, "music");
  if (signatureProblem) return NextResponse.json({ error: signatureProblem }, { status: 400 });

  const id = crypto.randomBytes(8).toString("hex");
  const fileName = `${id}${ext}`;
  const abs = path.join(MUSIC_DIR, fileName);
  const bytesWritten = await writeUploadedFile(file, abs, MAX_BYTES);

  const filePath = `/uploads/music/${fileName}`;
  const finalTitle = title || originalName.replace(/\.[^.]+$/, "");

  try {
    await prisma.music.create({
      data: {
        title: finalTitle,
        artist,
        filePath,
        fileSizeBytes: bytesWritten,
        sortOrder: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
        isEnabled: true
      }
    });
  } catch (error) {
    // The file is not a durable upload until its metadata row commits.
    await fs.unlink(abs).catch(() => undefined);
    throw error;
  }

  return redirectTo("/admin/music");
}

export async function DELETE(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const track = await prisma.music.findUnique({ where: { id }, select: { filePath: true } });
  if (!track) return NextResponse.json({ ok: true });

  // Delete metadata first. If unlink then fails, only an inert orphan remains;
  // never leave a visible track row pointing at a file already removed.
  await prisma.music.delete({ where: { id } });
  if (track.filePath) {
    const abs = resolveUploadsPath(track.filePath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
