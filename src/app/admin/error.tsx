"use client";

import Link from "next/link";
import { I18nText } from "@/components/I18nText";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="admin-route-error">
      <section className="admin-panel" role="alert">
        <span className="admin-error-mark" aria-hidden="true">!</span>
        <p className="eyebrow"><I18nText zh="管理页面暂时不可用" en="Admin page unavailable" /></p>
        <h1><I18nText zh="这里没有正常加载" en="This page did not load" /></h1>
        <p className="muted">
          <I18nText
            zh="可能是临时的网络或数据服务问题。你可以重试，已有数据不会因此改变。"
            en="This may be a temporary network or data-service issue. Retrying will not alter existing data."
          />
        </p>
        <div className="row-actions">
          <button className="button" type="button" onClick={reset}>
            <I18nText zh="重新加载" en="Try again" />
          </button>
          <Link className="button secondary" href="/admin">
            <I18nText zh="返回仪表盘" en="Back to dashboard" />
          </Link>
        </div>
      </section>
    </main>
  );
}
