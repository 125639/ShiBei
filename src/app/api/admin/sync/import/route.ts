import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { importFromZip } from "@/lib/sync/import";
import { MAX_SYNC_ZIP_BYTES } from "@/lib/sync/limits";
import { redirectTo } from "@/lib/redirect";
import { readUploadedFileBuffer } from "@/lib/upload-stream";
import { rejectCrossOriginMutation } from "@/lib/request-origin";

// POST /api/admin/sync/import
// 表单字段:
//   file: ZIP 文件(必填)
//   redirect: 跳回路径(可选,默认 /admin/sync)
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const form = await request.formData();
  const file = form.get("file");
  const redirectPath = safeRedirectPath(String(form.get("redirect") || "/admin/sync"));

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择一个 ZIP 文件" }, { status: 400 });
  }
  if (file.size > MAX_SYNC_ZIP_BYTES) {
    return NextResponse.json(
      { error: `ZIP 体积超过 ${Math.round(MAX_SYNC_ZIP_BYTES / 1024 / 1024)}MB，请拆分同步或改用外链视频` },
      { status: 413 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readUploadedFileBuffer(file, MAX_SYNC_ZIP_BYTES);
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
  // 列表/首页走 public-content 标签失效；被覆盖的文章详情页是 ISR(300s),
  // 必须按 slug 精准失效,否则更新后的正文要等最多 5 分钟才可见。
  revalidatePublicContent(result.upsertedPostSlugs.slice(0, 90).map((slug) => `/posts/${slug}`));

  // 如果调用者要 JSON,直接返回 JSON;否则跳回页面。
  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ ok: result.errors.length === 0, result }, { status: result.errors.length ? 207 : 200 });
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
