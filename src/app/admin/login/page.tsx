import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (session) redirect("/admin");

  const errorMsg =
    params.error === "db"
      ? "数据库连接失败，请检查 DATABASE_URL 配置后重启应用。"
      : params.error === "1"
        ? "用户名或密码错误，请重试。"
        : null;

  return (
    <main className="login-shell">
      <form className="form-card form-stack" action="/api/admin/login" method="post">
        <div>
          <p className="eyebrow">管理员入口</p>
          <h1>登录后台</h1>
          <p>第一版使用账号密码登录，登录后可在设置页修改用户名与密码。</p>
        </div>
        {errorMsg && <p className="form-error">{errorMsg}</p>}
        <div className="field">
          <label htmlFor="username">用户名</label>
          <input id="username" name="username" required autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <button className="button" type="submit">登录</button>
      </form>
    </main>
  );
}
