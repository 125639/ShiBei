import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

// 删除整个视频记录（含本地文件）。
// POST /api/admin/videos/delete?id=...&redirect=/admin/posts/<post-id>
export async function POST(request: Request) {
  return deleteVideo(request);
}

export async function GET(request: Request) {
  return deleteVideo(request);
}

async function deleteVideo(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const redirect = safeRedirectPath(url.searchParams.get("redirect"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const video = await prisma.video.findUnique({ where: { id } });
  if (video?.localPath) {
    const abs = path.join(process.cwd(), "public", video.localPath.replace(/^\/+/, ""));
    await fs.unlink(abs).catch(() => undefined);
  }
  if (video) {
    await prisma.video.delete({ where: { id } });
  }
  return redirectTo(redirect);
}

function safeRedirectPath(value: string | null) {
  const raw = value || "/admin/videos";
  return raw.startsWith("/admin/") || raw === "/admin" ? raw : "/admin/videos";
}
