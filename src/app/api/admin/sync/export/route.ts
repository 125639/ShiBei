import { NextResponse } from "next/server";
import { exportToZip } from "@/lib/sync/export";
import { getResolvedSyncConfig } from "@/lib/sync/config";
import { getSession } from "@/lib/auth";
import { bearerTokenMatches } from "@/lib/sync/token";

// GET /api/admin/sync/export?since=<ISO>
//
// 鉴权:
//   - 优先识别 Authorization: Bearer <共享密钥>(机机调用)
//   - 否则要求 admin session(管理员从 /admin/sync 点「立即导出 ZIP」)
//
// 返回:
//   200 application/zip,文件名 shibei-sync-<timestamp>.zip
export async function GET(request: Request) {
  const cfg = await getResolvedSyncConfig();
  const auth = request.headers.get("authorization") || "";
  let authorized = false;
  let viaBearer = false;
  if (bearerTokenMatches(auth, cfg.syncToken)) {
    authorized = true;
    viaBearer = true;
  } else {
    const session = await getSession().catch(() => null);
    if (session) authorized = true;
  }
  if (!authorized) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since");
  const includeLocalFiles = url.searchParams.get("includeFiles") === "1" || url.searchParams.get("includeFiles") === "true";
  let since: Date | null = null;
  if (sinceRaw) {
    const t = new Date(sinceRaw);
    if (!Number.isNaN(t.getTime())) since = t;
  }

  let buffer: Buffer;
  try {
    // 机机拉取（sync-worker 每分钟一次）不推进 lastExportedAt，
    // 否则后台「下载增量 ZIP」的窗口恒为最近一分钟、几乎必是空包。
    buffer = await exportToZip({ since, includeLocalFiles, advanceCursor: !viaBearer });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /超过|上限|增量导出/.test(message) ? 413 : 500;
    return NextResponse.json(
      { error: `导出失败: ${message}` },
      { status }
    );
  }

  const filename = `shibei-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
