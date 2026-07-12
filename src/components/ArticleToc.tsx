"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { I18nText } from "./I18nText";

type TocItem = { id: string; text: string; level: 2 | 3 };

/**
 * 文章小节导航：扫描正文里带 id 的 h2/h3（id 由 markdown 渲染器生成），
 * 点击平滑滚动回对应小节，滚动时高亮当前所在小节。
 *
 * 内容是客户端渲染的（语言切换 / 翻译到达时会整块替换），
 * 所以用 MutationObserver 监听容器变化后重扫，而不是只在挂载时扫一次。
 *
 * variant="ff-widget"：包上 Firefly 侧栏小组件外框（对齐官方主题的
 * 「文章目录」侧栏组件）。该实例挂在 PublicShell（layout，跨导航常驻），
 * 所以观察目标在容器缺席时退回 document.body，并随 pathname 重扫，
 * 保证从列表页导航进文章后目录能出现。没有标题时整个组件返回 null。
 */
export function ArticleToc({
  containerSelector = "article.prose",
  variant = "plain"
}: {
  containerSelector?: string;
  variant?: "plain" | "ff-widget";
}) {
  const pathname = usePathname();
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const didHashScroll = useRef(false);

  useEffect(() => {
    didHashScroll.current = false;
    setActiveId("");
  }, [pathname]);

  const scan = useCallback(() => {
    const container = document.querySelector(containerSelector);
    if (!container) {
      setItems([]);
      return;
    }
    const found: TocItem[] = [...container.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map((el) => ({
      id: el.id,
      text: (el.textContent || "").trim(),
      level: el.tagName === "H2" ? 2 : 3
    }));
    // 内容没变时保持原数组引用，避免无谓触发滚动监听的重建
    setItems((prev) =>
      prev.length === found.length && prev.every((p, i) => p.id === found[i].id && p.text === found[i].text)
        ? prev
        : found
    );
  }, [containerSelector]);

  useEffect(() => {
    scan();
    // 容器还没渲染（页面流式到达/尚在列表页）时观察 body 等它出现；
    // 一旦有容器就只观察容器，避免整页级别的无谓回调。
    const container = document.querySelector(containerSelector);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 150);
    });
    observer.observe(container ?? document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [scan, containerSelector, pathname]);

  // 滚动高亮：最后一个顶部越过阅读线（顶栏下方）的小节即当前小节
  useEffect(() => {
    if (!items.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const READING_LINE = 100;
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= READING_LINE) current = item.id;
        else break;
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items]);

  // 正文是客户端渲染的，带 #hash 直达时浏览器原生跳转会扑空——标题就绪后补一次
  useEffect(() => {
    if (didHashScroll.current || !items.length) return;
    didHashScroll.current = true;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [items]);

  const jumpTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  };

  if (items.length < 2) return null;

  const nav = (
    <nav className="article-toc" aria-label="文章小节导航">
      {variant === "plain" ? (
        <p className="article-toc-title">
          <I18nText zh="本文小节" en="On this page" />
        </p>
      ) : null}
      <ol>
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? "toc-depth-2" : undefined}>
            <a
              href={`#${encodeURIComponent(item.id)}`}
              className={activeId === item.id ? "is-active" : undefined}
              aria-current={activeId === item.id ? "location" : undefined}
              onClick={(event) => jumpTo(event, item.id)}
            >
              <span className="toc-label">{item.text}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  if (variant === "ff-widget") {
    return (
      <section className="ff-widget ff-toc-widget">
        <h2 className="ff-widget-title">
          <I18nText zh="文章目录" en="On this page" />
        </h2>
        {nav}
      </section>
    );
  }

  return nav;
}
