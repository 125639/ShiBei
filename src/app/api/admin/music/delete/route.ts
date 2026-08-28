import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { resolveUploadsPath } from "@/lib/uploads-path";

export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  const track = await prisma.music.findUnique({ where: { id }, select: { filePath: true } });

  if (track) await prisma.music.delete({ where: { id } });
  if (track?.filePath) {
    const abs = resolveUploadsPath(track.filePath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  return redirectTo("/admin/music");
}
