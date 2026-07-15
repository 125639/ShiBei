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
            zh="使用管理员发放的邀请码一次性开户，并设置你自己的登录密码。以账号身份新建的作品可长期保存，并保留完整的导出、删除权。匿名内容不会自动转入账号；登录期间会暂时隐藏，退出后仍可由原浏览器继续访问。"
            en="Use an administrator-issued invite code once to open an account, then choose your own login password. Works created under the account are retained with full export and delete rights. Anonymous content is never moved into an account automatically; it is hidden while signed in and remains available to the original browser after signing out."
          />
        </p>
      </section>
      <section className="form-card form-stack account-admin-entry">
        <p className="eyebrow">Administrator</p>
        <h2><I18nText zh="管理员入口" en="Administrator access" /></h2>
        <p className="muted-block">
          <I18nText
            zh="管理员账号与普通用户账号相互独立。使用管理员用户名和密码登录内容管理后台。"
            en="Administrator and member accounts are separate. Sign in with an administrator username and password to manage the site."
          />
        </p>
        <div className="row-actions">
          <Link className="button secondary" href="/admin/login">
            <I18nText zh="管理员登录 / 进入后台" en="Administrator sign-in" />
          </Link>
        </div>
      </section>
      <AccountClient />
    </main>
  );
}
