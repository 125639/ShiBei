import { redirect } from "next/navigation";
import { I18nText } from "@/components/I18nText";
import { SubmitButton } from "@/components/SubmitButton";
import { getSession } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (session) redirect("/admin");

  const errorMsg =
    params.error === "db"
      ? "暂时无法登录,请稍后再试。若问题持续,请联系系统管理员。"
      : params.error === "rate"
        ? "登录尝试过于频繁，请稍后再试。"
      : params.error === "1"
        ? "用户名或密码不正确。"
        : null;

  return (
    <main className="login-shell">
      <form className="form-card form-stack" action="/api/admin/login" method="post">
        <div>
          <p className="eyebrow"><I18nText zh="管理员入口" en="Admin" /></p>
          <h1><I18nText zh="登录后台" en="Sign in" /></h1>
          <p><I18nText zh="使用管理员账号登录。" en="Sign in with your admin account." /></p>
        </div>
        {errorMsg && <p className="form-error" role="alert">{errorMsg}</p>}
        <div className="field">
          <label htmlFor="username"><I18nText zh="用户名" en="Username" /><span aria-hidden="true" className="req">*</span></label>
          <input id="username" name="username" required autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password"><I18nText zh="密码" en="Password" /><span aria-hidden="true" className="req">*</span></label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <SubmitButton pendingLabel={<I18nText zh="登录中…" en="Signing in…" />}><I18nText zh="登录" en="Sign in" /></SubmitButton>
      </form>
    </main>
  );
}
