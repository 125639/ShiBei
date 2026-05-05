import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importFromZip } from "@/lib/sync/import";
import { redirectTo } from "@/lib/redirect";

// POST /api/admin/sync/import
// 表单字段:
//   file: ZIP 文件(必填)
//   redirect: 跳回路径(可选,默认 /admin/sync)
export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const file = form.get("file");
  const redirectPath = safeRedirectPath(String(form.get("redirect") || "/admin/sync"));

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择一个 ZIP 文件" }, { status: 400 });
  }
  if (file.size > 512 * 1024 * 1024) {
    return NextResponse.json({ error: "ZIP 体积超过 512MB，请拆分同步或改用外链视频" }, { status: 413 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `读取上传文件失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await importFromZip(buffer);
  } catch (err) {
    return NextResponse.json(
      { error: `导入失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  // 如果调用者要 JSON,直接返回 JSON;否则跳回页面。
  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ ok: true, result });
  }

  // 用 redirectTo 统一处理(传 request 优先用真实 host,反代友好;
  // 拿不到时退化为相对 Location,浏览器自动用当前 origin)。
  const params = new URLSearchParams();
  params.set("imported", String(result.postsUpserted));
  params.set("videos", String(result.videosUpserted));
  params.set("files", String(result.filesWritten));
  if (result.errors.length) params.set("errors", String(result.errors.length));
  return redirectTo(`${redirectPath}?${params.toString()}`, request);
}

function safeRedirectPath(value: string) {
  // 仅允许跳转到站内 /admin 子路径，杜绝 open redirect。
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/sync";
}
