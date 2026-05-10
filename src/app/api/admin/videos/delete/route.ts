import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { resolveUploadsPath } from "@/lib/uploads-path";

// 删除整个视频记录（含本地文件）。
// POST /api/admin/videos/delete?id=...&redirect=/admin/posts/<post-id>
// 仅接受 POST：删除是状态变更，GET 会被浏览器预取/链接预览误触发。
export async function POST(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const redirect = safeRedirectPath(url.searchParams.get("redirect"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const video = await prisma.video.findUnique({ where: { id } });
  if (video?.localPath) {
    // 必须经过 resolveUploadsPath：DB 里被写入 "../etc/passwd" 一类值时
    // 直接 path.join 会让 fs.unlink 变成任意文件删除原语。
    const abs = resolveUploadsPath(video.localPath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
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
