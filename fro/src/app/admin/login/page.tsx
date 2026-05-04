import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/admin");

  return (
    <main className="login-shell">
      <form className="form-card form-stack" action="/api/admin/login" method="post">
        <div>
          <p className="eyebrow">管理员入口</p>
          <h1>登录后台</h1>
          <p>第一版使用账号密码登录，登录后可在设置页修改用户名与密码。</p>
        </div>
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
