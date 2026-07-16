import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runAutoSync } from "@/lib/sync/auto-sync";
import { isFrontend, isFull } from "@/lib/app-mode";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revalidatePublicContent } from "@/lib/revalidate-public";

// POST /api/admin/sync/pull
// 立即从已配置的 backend 入口拉取增量并 import。
// 仅 frontend 与 full 模式有意义。
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  if (!isFrontend() && !isFull()) {
    return NextResponse.json(
      { error: "仅 frontend / full 模式支持拉取" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await runAutoSync();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
  if ((result.result?.postsUpserted || 0) + (result.result?.videosUpserted || 0) > 0) {
    // 与手动 ZIP 导入一致:导入了新内容就立即失效公开页缓存,
    // 文章详情页(ISR)按 slug 精准失效。
    revalidatePublicContent(
      (result.result?.upsertedPostSlugs || []).slice(0, 90).map((slug) => `/posts/${slug}`)
    );
  }

  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json(result);
  }
  return redirectTo("/admin/sync", request);
}
