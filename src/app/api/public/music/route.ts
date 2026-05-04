import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Public list of enabled music tracks for the floating player.
 *
 * Tracks are stored in /public/uploads/music/, so the file path returned here
 * is a relative URL the browser can fetch directly.
 */
export async function GET() {
  try {
    const tracks = await (prisma as unknown as {
      music: {
        findMany: (args: unknown) => Promise<Array<{
          id: string;
          title: string;
          artist: string | null;
          filePath: string;
          isEnabled: boolean;
          sortOrder: number;
        }>>;
      };
    }).music.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });

    return NextResponse.json({
      tracks: tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        filePath: t.filePath
      }))
    });
  } catch {
    // Music model may not exist yet (pre-migration). Return empty list.
    return NextResponse.json({ tracks: [] });
  }
}
