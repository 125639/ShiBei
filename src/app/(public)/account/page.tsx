import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { AccountClient } from "@/components/AccountClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "账户",
  description: "使用邀请码注册 / 登录，管理你的共创作品：导出与删除权完全归创作者。",
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
            zh="使用管理员发放的邀请码注册，即可长期保存作品并保留完整的导出、删除权。未登录也能创作，但单个 IP 最多生成 2 篇，且发布后不可删除。"
            en="Register with an administrator-issued invite code to keep your works with full export and delete rights. Anonymous creation is limited to 2 generated works per IP, and published anonymous works cannot be deleted."
          />
        </p>
      </section>
      <AccountClient />
    </main>
  );
}
