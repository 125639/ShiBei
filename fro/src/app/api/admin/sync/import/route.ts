import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importFromZip } from "@/lib/sync/import";

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

  // 优先用 request 自身的 origin 拼跳转地址，避免 NEXT_PUBLIC_SITE_URL 配错时
  // 把用户带到 localhost / 别的域名。
  const base = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    }
  })();
  const url = new URL(redirectPath, base);
  url.searchParams.set("imported", String(result.postsUpserted));
  url.searchParams.set("videos", String(result.videosUpserted));
  url.searchParams.set("files", String(result.filesWritten));
  if (result.errors.length) url.searchParams.set("errors", String(result.errors.length));
  return NextResponse.redirect(url, 303);
}

function safeRedirectPath(value: string) {
  // 仅允许跳转到站内 /admin 子路径，杜绝 open redirect。
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/sync";
}
