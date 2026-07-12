import { I18nText } from "@/components/I18nText";

export default function AdminLoading() {
  return (
    <div className="admin-route-loading" aria-busy="true" aria-live="polite">
      <aside aria-hidden="true">
        <div className="admin-loading-brand skeleton" />
        {Array.from({ length: 10 }, (_, index) => (
          <div className="admin-loading-nav skeleton" key={index} />
        ))}
      </aside>
      <main>
        <span className="sr-only" role="status">
          <I18nText zh="正在加载管理页面…" en="Loading the admin page…" />
        </span>
        <div className="admin-loading-title skeleton" aria-hidden="true" />
        <div className="admin-loading-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="admin-loading-card skeleton" key={index} />
          ))}
        </div>
        <div className="admin-loading-panel skeleton" aria-hidden="true" />
      </main>
    </div>
  );
}
