import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { resolveUploadsPath } from "@/lib/uploads-path";

export async function POST(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  const track = await (prisma as unknown as {
    music: {
      findUnique: (args: unknown) => Promise<{ filePath: string } | null>;
      delete: (args: unknown) => Promise<unknown>;
    };
  }).music.findUnique({ where: { id } });

  if (track?.filePath) {
    const abs = resolveUploadsPath(track.filePath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  if (track) {
    await (prisma as unknown as {
      music: { delete: (args: unknown) => Promise<unknown> };
    }).music.delete({ where: { id } });
  }
  return redirectTo("/admin/music");
}
