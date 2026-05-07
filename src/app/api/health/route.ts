import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";

// 简单的健康检查端点，供 Docker / k8s / 反向代理使用。
// - 200：可对外提供 HTTP 服务，且 DB 可达
// - 503：DB 不可达，应该重启或继续等待 postgres 拉起
//
// 不依赖鉴权；不返回敏感信息。任何模式都会响应。

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = getAppMode();
  try {
    // 走最便宜的查询。失败说明 DB 还没准备好或连接信息不对。
    await prisma.$queryRawUnsafe("SELECT 1");
    return NextResponse.json({ ok: true, mode, db: "up", ts: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        db: "down",
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

// HEAD 请求不读 DB，只确认进程在跑。一些反代/容器健康检查偏好 HEAD。
export async function HEAD() {
  return new Response(null, { status: 200 });
}
