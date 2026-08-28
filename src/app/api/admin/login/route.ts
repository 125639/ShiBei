import bcrypt from "bcryptjs";

// 与真实密码哈希同 cost(12) 的常量哈希，用于「用户不存在」路径的时序对齐。
const TIMING_EQUALIZER_HASH = "$2a$12$L2IUnMg38dhnkZZ8JwUpM.l5YetxGZ6KXzrByNyeu4QTPSXE60C66";
import { createSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, checkSubjectRateLimit } from "@/lib/rate-limit";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded" && mediaType !== "multipart/form-data") {
    return Response.json(
      { error: "管理员登录必须使用表单提交" },
      { status: 415, headers: { "Cache-Control": "no-store" } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "登录表单格式无效" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const limited = await checkRateLimit({
    namespace: "admin-login",
    request,
    subject: username || "blank",
    limit: 8,
    windowSec: 15 * 60
  });
  const accountLimited = await checkSubjectRateLimit({
    namespace: "admin-login",
    subject: username || "blank",
    limit: 8,
    windowSec: 15 * 60
  });
  if (!limited.ok || !accountLimited.ok) {
    console.warn("[login] 登录尝试过于频繁，已限速");
    return redirectTo("/admin/login?error=rate", request);
  }

  let user;
  try {
    user = await prisma.adminUser.findUnique({ where: { username } });
  } catch (err) {
    console.error("[login] 数据库查询失败:", err);
    return redirectTo("/admin/login?error=db", request);
  }

  if (!user) {
    // 用户不存在时也执行一次等价开销的 bcrypt 比对：两条路径耗时一致，
    // 否则响应时延差异（~百毫秒）可用于枚举有效用户名。
    await bcrypt.compare(password, TIMING_EQUALIZER_HASH);
    console.warn("[login] 用户名或密码错误");
    return redirectTo("/admin/login?error=1", request);
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    console.warn("[login] 用户名或密码错误");
    return redirectTo("/admin/login?error=1", request);
  }

  await setSessionCookie(await createSession(user.id, user.tokenVersion));
  return redirectTo("/admin", request);
}
