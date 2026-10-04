"use client";

import { useState, type ReactNode } from "react";
import { I18nText, useRouteLanguage } from "@/components/I18nTextClient";

/** Only filter metadata is hydrated; the article cards remain server-rendered children. */
export function PostShelf({
  items,
  topics
}: {
  items: { id: string; topicIds: string[]; card: ReactNode }[];
  topics: { id: string; name: string }[];
}) {
  const [active, setActive] = useState("all");
  const english = useRouteLanguage() === "en";
  const visible = active === "all" ? items : items.filter((item) => item.topicIds.includes(active));
  return (
    <div className="post-shelf">
      {topics.length > 1 ? (
        <div className="shelf-controls">
          <div
            className="shelf-filters"
            role="group"
            aria-label={english ? "Filter recent stories by topic" : "按主题筛选最近文章"}
          >
            <button type="button" aria-pressed={active === "all"} onClick={() => setActive("all")}>
              <I18nText zh="全部内容" en="All stories" />
              <span>{items.length}</span>
            </button>
            {topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                aria-pressed={active === topic.id}
                onClick={() => setActive(topic.id)}
              >
                {topic.name}
              </button>
            ))}
          </div>
          <span className="shelf-caption">
            <I18nText zh="保持好奇，持续发现" en="Stay curious. Keep exploring." />
          </span>
        </div>
      ) : null}
      <p className="sr-only" role="status">
        <I18nText zh={`显示 ${visible.length} 篇最近文章`} en={`Showing ${visible.length} recent stories`} />
      </p>
      <div className="story-grid" key={active}>
        {visible.map((item) => (
          <div className="story-grid-item" key={item.id}>
            {item.card}
          </div>
        ))}
      </div>
    </div>
  );
}
