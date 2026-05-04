import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runAutoSync } from "@/lib/sync/auto-sync";
import { isFrontend, isFull } from "@/lib/app-mode";
import { redirectTo } from "@/lib/redirect";

// POST /api/admin/sync/pull
// 立即从已配置的 backend 入口拉取增量并 import。
// 仅 frontend 与 full 模式有意义。
export async function POST(request: Request) {
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

  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json(result);
  }
  return redirectTo("/admin/sync", request);
}
