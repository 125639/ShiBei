import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { MAX_COOKIES_BYTES, looksLikeNetscapeCookies } from "@/lib/ytdlp-cookies";

// yt-dlp 下载用 cookies.txt 管理（后台→视频管理）。
// POST 表单：
//   action=clear                  → 删除已存 cookies
//   cookiesFile=<file>（multipart）→ 校验 Netscape 格式后加密入库
// 明文绝不落日志/回显；密文存 SiteSettings.ytDlpCookiesEnc（ENCRYPTION_KEY）。
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const form = await request.formData();
  const redirect = "/admin/videos";

  if (String(form.get("action") || "") === "clear") {
    await prisma.siteSettings.update({
      where: { id: "site" },
      data: { ytDlpCookiesEnc: null, ytDlpCookiesUpdatedAt: null }
    });
    return redirectTo(redirect, request);
  }

  const file = form.get("cookiesFile");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择要上传的 cookies.txt 文件" }, { status: 400 });
  }
  if (file.size > MAX_COOKIES_BYTES) {
    return NextResponse.json({ error: "cookies 文件过大（上限 256KB）" }, { status: 400 });
  }
  const text = await file.text();
  if (!looksLikeNetscapeCookies(text)) {
    return NextResponse.json(
      { error: "文件不是 Netscape 格式的 cookies.txt（请用浏览器扩展导出，如 Get cookies.txt LOCALLY）" },
      { status: 400 }
    );
  }

  await prisma.siteSettings.update({
    where: { id: "site" },
    data: { ytDlpCookiesEnc: encryptSecret(text), ytDlpCookiesUpdatedAt: new Date() }
  });
  return redirectTo(redirect, request);
}
