import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getUpdaterStatus } from "@/lib/update";
import { getBuildInfo } from "@/lib/build-info";

export const dynamic = "force-dynamic";

// GET /api/admin/update/status
// 代理 updater 的更新任务状态 + 日志。应用重启完成后前端靠对比
// runningCommit 是否变化来确认新版本已上线。
export async function GET() {
  await requireAdmin();
  const status = await getUpdaterStatus();
  const build = getBuildInfo();
  return NextResponse.json(
    { ...status, runningCommit: build.commit, builtAt: build.builtAt },
    { headers: { "cache-control": "no-store" } }
  );
}
