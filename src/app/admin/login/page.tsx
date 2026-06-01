import { redirect } from "next/navigation";
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
          <p className="eyebrow">管理员入口</p>
          <h1>登录后台</h1>
          <p>使用管理员账号登录。</p>
        </div>
        {errorMsg && <p className="form-error" role="alert">{errorMsg}</p>}
        <div className="field">
          <label htmlFor="username">用户名<span aria-hidden="true" className="req">*</span></label>
          <input id="username" name="username" required autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">密码<span aria-hidden="true" className="req">*</span></label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <SubmitButton pendingLabel="登录中…">登录</SubmitButton>
      </form>
    </main>
  );
}
