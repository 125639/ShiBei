"use client";

import { useEffect } from "react";
import Link from "next/link";
import { I18nText } from "@/components/I18nText";

export default function PublicError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="container route-error">
      <section className="bento-card error-card">
        <p className="eyebrow-apple">500</p>
        <h1><I18nText zh="页面出了点问题" en="Something went wrong" /></h1>
        <p className="muted-block">
          <I18nText
            zh="服务器处理这个页面时出现了错误。你可以重试一次，或先回到首页。"
            en="The server hit an error while rendering this page. You can retry, or head back home."
          />
          {error.digest ? <span className="error-digest"> (digest: {error.digest})</span> : null}
        </p>
        <div className="cta-row">
          <button className="button" type="button" onClick={() => reset()}>
            <I18nText zh="重试" en="Try again" />
          </button>
          <Link className="button secondary" href="/">
            <I18nText zh="回到首页" en="Back to home" />
          </Link>
        </div>
      </section>
    </main>
  );
}
