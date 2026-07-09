import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { triggerUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

// POST /api/admin/update/apply
// 触发 updater 伴车容器执行更新（git reset → compose build → up -d）。
// 异步启动，进度通过 /api/admin/update/status 轮询。
export async function POST() {
  await requireAdmin();
  const result = await triggerUpdate();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
