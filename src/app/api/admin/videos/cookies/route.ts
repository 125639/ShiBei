import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { MAX_COOKIES_BYTES, looksLikeNetscapeCookies } from "@/lib/ytdlp-cookies";

// yt-dlp 下载用 cookies.txt 管理（后台→视频管理）。
// POST 表单：
//   action=clear                    → 删除已存 cookies
//   cookiesText=<粘贴的文本>         → 直接粘贴 Netscape 内容（优先）
//   cookiesFile=<file>（multipart）  → 或上传导出的 cookies.txt
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

  // 粘贴文本优先；否则回退到上传的文件。两者都空才报错。
  let text = String(form.get("cookiesText") || "").trim();
  if (!text) {
    const file = form.get("cookiesFile");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_COOKIES_BYTES) {
        return NextResponse.json({ error: "cookies 文件过大（上限 256KB）" }, { status: 400 });
      }
      text = (await file.text()).trim();
    }
  }

  if (!text) {
    return NextResponse.json({ error: "请在文本框粘贴 cookies 内容，或选择要上传的 cookies.txt 文件" }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_COOKIES_BYTES) {
    return NextResponse.json({ error: "cookies 内容过大（上限 256KB）" }, { status: 400 });
  }
  if (!looksLikeNetscapeCookies(text)) {
    return NextResponse.json(
      { error: "内容不是 Netscape 格式的 cookies.txt（请用浏览器扩展导出，如 Get cookies.txt LOCALLY，再粘贴或上传）" },
      { status: 400 }
    );
  }

  await prisma.siteSettings.update({
    where: { id: "site" },
    data: { ytDlpCookiesEnc: encryptSecret(text), ytDlpCookiesUpdatedAt: new Date() }
  });
  return redirectTo(redirect, request);
}
