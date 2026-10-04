"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { I18nText, useRouteLanguage } from "@/components/I18nTextClient";
import { applyQuickStyle, persistQuickStyle, readQuickStyle } from "@/lib/quick-style";
import { Icon } from "./Icons";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-posts-layout"] });
  return () => observer.disconnect();
}
function snapshot() {
  return document.documentElement.getAttribute("data-posts-layout") || "default";
}

export function PostsCollection({
  children,
  defaultLayout,
  count,
  query,
  topic
}: {
  children: ReactNode;
  defaultLayout: "grid" | "list" | "magazine";
  count: number;
  query: string;
  topic?: string;
}) {
  const savedLayout = useSyncExternalStore(subscribe, snapshot, () => "default");
  const layout = savedLayout === "list" || savedLayout === "grid" ? savedLayout : defaultLayout;
  const english = useRouteLanguage() === "en";
  function change(next: "grid" | "list") {
    const prefs = { ...readQuickStyle(), postsLayout: next };
    applyQuickStyle(prefs);
    persistQuickStyle(prefs);
  }
  return (
    <section className="publication-collection" aria-label={english ? "Published stories" : "已发布文章"}>
      <div className="publication-collection-toolbar">
        <p className="publication-collection-count" role="status">
          <I18nText
            zh={
              <>
                <strong>{count}</strong> 篇文章{topic ? ` · ${topic}` : ""}
                {query ? ` · 搜索「${query}」` : ""}
              </>
            }
            en={
              <>
                <strong>{count}</strong> {count === 1 ? "story" : "stories"}
                {topic ? ` · ${topic}` : ""}
                {query ? ` · “${query}”` : ""}
              </>
            }
          />
        </p>
        <div
          className="publication-view-switch"
          role="group"
          aria-label={english ? "Article layout" : "文章布局"}
        >
          <button
            type="button"
            aria-label={english ? "Grid layout" : "网格布局"}
            aria-pressed={layout !== "list"}
            onClick={() => change("grid")}
          >
            <Icon name="grid" />
          </button>
          <button
            type="button"
            aria-label={english ? "List layout" : "列表布局"}
            aria-pressed={layout === "list"}
            onClick={() => change("list")}
          >
            <Icon name="list" />
          </button>
        </div>
      </div>
      <div className="publication-collection-grid" data-layout={layout}>
        {children}
      </div>
    </section>
  );
}
