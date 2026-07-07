import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeGenre } from "@/lib/creation-server";
import { CREATION_DEPTHS, CREATION_MODES } from "@/lib/creation";

export const dynamic = "force-dynamic";

// 题材列表即评分标尺列表：选题材的同时就确定了评分维度、权重与公开阈值，
// 前端在第一步把标尺完整展示给创作者。
export async function GET() {
  const genres = await prisma.creationGenre.findMany({
    where: { isEnabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return NextResponse.json({
    genres: genres.map(serializeGenre),
    depths: CREATION_DEPTHS,
    modes: CREATION_MODES
  });
}
