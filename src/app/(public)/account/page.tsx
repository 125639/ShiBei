import type { Metadata } from "next";
import Link from "next/link";
import { I18nText } from "@/components/I18nText";
import { AccountClient } from "@/components/AccountClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "账户",
  description: "使用邀请码开户并设置自己的密码，登录后管理共创作品：导出与删除权完全归创作者。",
  alternates: { canonical: "/account" }
};

export default function AccountPage() {
  return (
    <main className="container container-narrow bento-page account-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Account</p>
        <h1 className="page-title"><I18nText zh="账户" en="Account" /></h1>
        <p className="muted-block">
          <I18nText
            zh="以账号身份新建的作品可长期保存，并保留完整的导出、删除权。匿名内容不会自动转入账号；登录期间会暂时隐藏，退出后仍可由原浏览器继续访问。"
            en="Works created under an account are retained with full export and delete rights. Anonymous content is never moved into an account automatically; it is hidden while signed in and remains available to the original browser after signing out."
          />
        </p>
        <p className="muted-block account-intro-hint">
          <I18nText
            zh="第一次来？找管理员要一个邀请码，在下方切到「注册」页签填写邀请码并设置密码，即可开户。已有账号直接在「登录」页签用邮箱或用户名登录。"
            en="First time here? Ask the administrator for an invite code, switch to the Register tab below, enter the code and set a password. Existing members sign in with email or username."
          />
        </p>
      </section>
      <AccountClient />
      <section className="form-card form-stack account-admin-entry">
        <p className="eyebrow">Administrator</p>
        <h2><I18nText zh="管理员入口" en="Administrator access" /></h2>
        <p className="muted-block">
          <I18nText
            zh="管理员账号与普通用户账号相互独立。使用管理员用户名和密码登录内容管理后台；邀请码也在后台「邀请码」页生成。"
            en="Administrator and member accounts are separate. Sign in with an administrator username and password to manage the site; invite codes are issued from the admin Invites page."
          />
        </p>
        <div className="row-actions">
          <Link className="button secondary" href="/admin/login">
            <I18nText zh="管理员登录 / 进入后台" en="Administrator sign-in" />
          </Link>
        </div>
      </section>
    </main>
  );
}
