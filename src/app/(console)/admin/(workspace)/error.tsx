"use client";

import { I18nText } from "@/components/I18nTextClient";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="admin-panel" role="alert">
      <h1>
        <I18nText zh="这部分内容暂时未能加载" en="This section could not be loaded" />
      </h1>
      <p className="muted">
        <I18nText
          zh="可以重试，或使用侧栏继续处理其他工作。已有数据不会因此改变。"
          en="Try again, or use the sidebar to continue working. Your existing data is unchanged."
        />
      </p>
      <button className="button" type="button" onClick={reset}>
        <I18nText zh="重试" en="Try again" />
      </button>
    </section>
  );
}
