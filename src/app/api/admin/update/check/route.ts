import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { checkForUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

// GET /api/admin/update/check[?force=1]
// 检查 GitHub 上是否有新版本。结果服务端缓存 10 分钟；force=1 绕过缓存
//（管理页「检查更新」按钮用）。
export async function GET(request: NextRequest) {
  await requireAdmin();
  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await checkForUpdate(force);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
