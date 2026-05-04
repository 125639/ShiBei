import { NextResponse } from "next/server";
import { translatePostToEnglish } from "@/lib/ai";
import { getModelConfigForUse } from "@/lib/model-selection";
import { prisma } from "@/lib/prisma";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // frontend 模式:本地不持有 API Key,优先看缓存,缺翻译就转给 backend。
  if (isFrontend()) {
    const cached = await prisma.post.findUnique({ where: { id } });
    if (cached && cached.titleEn && cached.summaryEn && cached.contentEn) {
      return NextResponse.json({
        title: cached.titleEn,
        summary: cached.summaryEn,
        content: cached.contentEn,
        cached: true,
      });
    }
    return proxyToBackend(request, `/api/public/posts/${encodeURIComponent(id)}/translate`);
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.status !== "PUBLISHED") {
    return NextResponse.json({ error: "post not found" }, { status: 404 });
  }

  if (post.titleEn && post.summaryEn && post.contentEn) {
    return NextResponse.json({ title: post.titleEn, summary: post.summaryEn, content: post.contentEn, cached: true });
  }

  const modelConfig = await getModelConfigForUse("translation");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置翻译模型" }, { status: 503 });
  }

  const translated = await translatePostToEnglish({
    modelConfig,
    title: post.title,
    summary: post.summary,
    content: post.content
  });

  await prisma.post.update({
    where: { id: post.id },
    data: {
      titleEn: translated.title,
      summaryEn: translated.summary,
      contentEn: translated.content,
      translatedAt: new Date()
    }
  });

  return NextResponse.json({ ...translated, cached: false });
}
