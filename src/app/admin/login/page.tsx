import { redirect } from "next/navigation";
import { I18nText } from "@/components/I18nText";

export const dynamic = "force-dynamic";
import { SubmitButton } from "@/components/SubmitButton";
import { getSession } from "@/lib/auth";

type LoginError = { zh: string; en: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; accountChanged?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (session) redirect("/admin");

  const error = getLoginError(params.error);
  const credentialsInvalid = params.error === "1";

  return (
    <main className="login-shell login-page-shell">
      <section className="login-surface" aria-labelledby="login-brand-title">
        <div className="login-brand-panel">
          <div className="login-brand-lockup">
            <span className="login-brand-mark" aria-hidden="true">拾</span>
            <span>ShiBei</span>
          </div>
          <div className="login-brand-content">
            <p className="eyebrow"><I18nText zh="管理工作区" en="Admin workspace" /></p>
            <h1 id="login-brand-title">ShiBei Admin</h1>
            <p className="login-brand-lead">
              <I18nText
                zh="在一个清晰、专注的工作区里审核内容、跟进任务并维护信息源。"
                en="Review content, follow jobs, and maintain sources in one focused workspace."
              />
            </p>
          </div>
          <ul className="login-feature-list">
            <li><I18nText zh="集中处理草稿与发布内容" en="Manage drafts and published content" /></li>
            <li><I18nText zh="快速查看任务与来源状态" en="Monitor jobs and source health" /></li>
            <li><I18nText zh="管理员会话与操作受保护" en="Protected administrator sessions" /></li>
          </ul>
        </div>

        <form
          className="form-card form-stack login-form-panel"
          action="/api/admin/login"
          method="post"
          aria-labelledby="login-form-title"
        >
          <header className="login-form-header">
            <p className="eyebrow"><I18nText zh="欢迎回来" en="Welcome back" /></p>
            <h2 id="login-form-title"><I18nText zh="登录后台" en="Sign in" /></h2>
            <p className="muted" id="login-form-description">
              <I18nText zh="使用管理员账号继续。" en="Continue with your administrator account." />
            </p>
          </header>

          {error ? (
            <p className="form-error" id="login-error" role="alert">
              <I18nText zh={error.zh} en={error.en} />
            </p>
          ) : null}
          {params.accountChanged === "1" ? (
            <p className="form-success" role="status">
              <I18nText
                zh="管理员账号已更新，所有旧会话均已失效。请使用新凭据重新登录。"
                en="The administrator account was updated and all old sessions were revoked. Sign in again with the new credentials."
              />
            </p>
          ) : null}

          <div className="field">
            <label htmlFor="username">
              <I18nText zh="用户名" en="Username" />
              <span aria-hidden="true" className="req">*</span>
            </label>
            <input
              id="username"
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={credentialsInvalid || undefined}
              aria-describedby={error ? "login-error" : "login-form-description"}
            />
          </div>
          <div className="field">
            <label htmlFor="password">
              <I18nText zh="密码" en="Password" />
              <span aria-hidden="true" className="req">*</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={credentialsInvalid || undefined}
              aria-describedby={error ? "login-error" : "login-form-description"}
            />
          </div>
          <SubmitButton pendingLabel={<I18nText zh="登录中…" en="Signing in…" />}>
            <I18nText zh="登录" en="Sign in" />
          </SubmitButton>
          <p className="login-form-note muted">
            <I18nText
              zh="请仅在受信任的设备上登录；完成工作后记得退出。"
              en="Sign in only on a trusted device, and log out when your work is complete."
            />
          </p>
        </form>
      </section>
    </main>
  );
}

function getLoginError(code: string | undefined): LoginError | null {
  if (code === "db") {
    return {
      zh: "暂时无法登录，请稍后再试。若问题持续，请联系系统管理员。",
      en: "Sign-in is temporarily unavailable. Try again later or contact the system administrator."
    };
  }
  if (code === "rate") {
    return {
      zh: "登录尝试过于频繁，请稍后再试。",
      en: "Too many sign-in attempts. Please wait and try again."
    };
  }
  if (code === "1") {
    return {
      zh: "用户名或密码不正确。",
      en: "The username or password is incorrect."
    };
  }
  return null;
}
