import { I18nText } from "@/components/I18nText";

/** Only the content region loads. The sidebar remains interactive and stable. */
export default function WorkspaceLoading() {
  return (
    <div className="admin-content-loading" aria-busy="true">
      <p role="status">
        <I18nText zh="正在加载内容…" en="Loading content…" />
      </p>
      <div className="admin-loading-title skeleton" aria-hidden="true" />
      <div className="admin-loading-grid" aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <div key={key} className="admin-loading-card skeleton" />
        ))}
      </div>
    </div>
  );
}
