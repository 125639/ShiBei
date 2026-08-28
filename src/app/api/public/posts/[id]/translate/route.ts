import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { translatePostToEnglish } from "@/lib/ai";
import { getModelConfigForUse } from "@/lib/model-selection";
import { prisma } from "@/lib/prisma";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";
import { ensureBackendCallerAllowed, publicAiRateLimitIdentity } from "@/lib/sync/backend-auth";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { withInFlightLock } from "@/lib/in-flight";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // frontend 模式:本地不持有 API Key,优先看缓存,缺翻译就转给 backend。
  if (isFrontend()) {
    const cached = await prisma.post.findUnique({ where: { id } });
    if (cached && (cached.status !== "PUBLISHED" || cached.publicationBlockedReason)) {
      return NextResponse.json({ error: "文章不存在或未发布" }, { status: 404 });
    }
    if (
      cached?.status === "PUBLISHED"
      && !cached.publicationBlockedReason
      && cached.titleEn
      && cached.summaryEn
      && cached.contentEn
    ) {
      return NextResponse.json({
        title: cached.titleEn,
        summary: cached.summaryEn,
        content: cached.contentEn,
        cached: true,
      });
    }
    // 缺翻译才代理到 backend；先做本地 per-IP 限流，双保险：backend 侧靠转发
    // 的访客标识区分，本地这层保证单个访客占不满全站共享额度。
    const limited = await checkRateLimit({ namespace: "translate", request, limit: 90, windowSec: 60 * 60 });
    if (!limited.ok) {
      return NextResponse.json(
        { error: "翻译请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }
    return proxyToBackend(request, `/api/public/posts/${encodeURIComponent(id)}/translate`);
  }

  // backend 模式暴露在公网时，必须验证共享密钥，否则任何人都能消耗你的模型 Key。
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  // per-IP 上限要容得下 202 pending 的轮询（客户端 3s 一次、上限 40 次）；
  // 真正昂贵的模型调用由 in-flight 锁 + 每日全局预算兜底。
  // 已鉴权的前端代理调用按其转发的原始访客标识限流，而不是前端出口 IP。
  const limited = await checkRateLimit({
    namespace: "translate",
    request,
    limit: 90,
    windowSec: 60 * 60,
    identityOverride: publicAiRateLimitIdentity(request)
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "翻译请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.status !== "PUBLISHED" || post.publicationBlockedReason) {
    return NextResponse.json({ error: "文章不存在或未发布" }, { status: 404 });
  }

  if (post.titleEn && post.summaryEn && post.contentEn) {
    return NextResponse.json({ title: post.titleEn, summary: post.summaryEn, content: post.contentEn, cached: true });
  }
  if (post.pendingRevision !== null) {
    return NextResponse.json({ error: "文章正在审核修改，请待新版本发布后再生成翻译" }, { status: 409 });
  }

  const modelConfig = await getModelConfigForUse("translation");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置翻译模型" }, { status: 503 });
  }

  const locked = await withInFlightLock(`translate:${post.id}`, 10 * 60, async () => {
    const latest = await prisma.post.findUnique({ where: { id: post.id } });
    if (!latest || latest.status !== "PUBLISHED" || latest.publicationBlockedReason || latest.pendingRevision !== null) {
      return { unavailable: true as const };
    }
    if (latest?.titleEn && latest.summaryEn && latest.contentEn) {
      return { title: latest.titleEn, summary: latest.summaryEn, content: latest.contentEn, cached: true };
    }

    // 每日总预算只对真正要调模型的请求计数——放在锁内、缓存复查之后：
    // 缓存命中和排队轮询（拿不到锁直接 202）都不该消耗额度。
    const globalLimited = await checkGlobalRateLimit({
      namespace: "translate",
      limit: envInt("AI_TRANSLATION_DAILY_LIMIT", 120),
      windowSec: 24 * 60 * 60
    });
    if (!globalLimited.ok) {
      throw new DailyBudgetExceededError(globalLimited.retryAfterSec);
    }

    const translated = await translatePostToEnglish({
      modelConfig,
      title: latest.title,
      summary: latest.summary,
      content: latest.content
    });

    const updated = await prisma.post.updateMany({
      where: {
        id: post.id,
        status: "PUBLISHED",
        publicationBlockedReason: null,
        updatedAt: latest.updatedAt
      },
      data: {
        titleEn: translated.title,
        summaryEn: translated.summary,
        contentEn: translated.content,
        translatedAt: new Date()
      }
    });
    if (updated.count !== 1) return { unavailable: true as const };

    // 文章页是 ISR 缓存的：翻译落库后失效对应页面，下次访问直接带上 contentEn，
    // 客户端不用再走轮询（本次请求的调用方已经拿到返回值，不受影响）。
    revalidatePath(`/posts/${post.slug}`);

    return { ...translated, cached: false };
  }).catch((error: unknown) => {
    if (error instanceof DailyBudgetExceededError) return error;
    throw error;
  });

  if (locked instanceof DailyBudgetExceededError) {
    return NextResponse.json(
      { error: "今日翻译额度已用完，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(locked.retryAfterSec) } }
    );
  }

  if (!locked.ok) {
    return NextResponse.json(
      { pending: true, error: "translation already in progress" },
      { status: 202, headers: { "Retry-After": "3" } }
    );
  }

  if ("unavailable" in locked.value) {
    return NextResponse.json({ error: "文章不存在或未发布" }, { status: 404 });
  }

  return NextResponse.json(locked.value);
}

class DailyBudgetExceededError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super("daily translation budget exceeded");
    this.retryAfterSec = Math.max(1, retryAfterSec);
  }
}

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
