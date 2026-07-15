import Link from "next/link";
import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";

export const metadata: Metadata = {
  title: "页面不存在"
};

// 根级 not-found 同时会作为正常页面 Flight payload 的兜底树发送。
// 保持它轻量，避免每个公开页面都重复序列化一整套 PublicShell。
export default function NotFound() {
  return (
    <main className="container route-error">
      <section className="bento-card error-card">
        <p className="eyebrow-apple">404</p>
        <h1><I18nText zh="这一页不存在" en="Page not found" /></h1>
        <p className="muted-block">
          <I18nText
            zh="链接可能已失效，或内容已被移动、下线。"
            en="The link may be broken, or the content has been moved or unpublished."
          />
        </p>
        <div className="cta-row">
          <Link className="button" href="/">
            <I18nText zh="回到首页" en="Back to home" />
          </Link>
          <Link className="button secondary" href="/posts">
            <I18nText zh="浏览全部文章" en="Browse posts" />
          </Link>
        </div>
      </section>
    </main>
  );
}
