"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { I18nText } from "./I18nText";

type TocItem = { id: string; text: string; level: 2 | 3 };

/**
 * 文章小节导航：扫描正文里带 id 的 h2/h3（id 由 markdown 渲染器生成），
 * 点击平滑滚动回对应小节，滚动时高亮当前所在小节。
 *
 * 内容是客户端渲染的（语言切换 / 翻译到达时会整块替换），
 * 所以用 MutationObserver 监听容器变化后重扫，而不是只在挂载时扫一次。
 *
 * 桌面版使用贴住视口右缘的 rail；移动版使用正文上方的折叠目录。
 * 没有足够标题时整个组件返回 null。
 */
export function ArticleToc({
  containerSelector = "article.prose",
  variant = "plain"
}: {
  containerSelector?: string;
  variant?: "plain" | "rail";
}) {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const didHashScroll = useRef(false);
  // 点击目录后把高亮锁定在所点小节:平滑滚动途中的中间位置、图片/翻译加载造成的
  // 落点偏移、以及靠近文末的小节永远够不到阅读线这三种情况,都不该把高亮抢走。
  // 用户重新滚动(滚轮/触摸/滚动键)时解锁,交还给滚动计算。
  // 对象引用保持稳定,release 字段随每次点击更新。
  const pin = useRef({ id: "", release: () => {} });

  useEffect(() => {
    didHashScroll.current = false;
    pin.current.release();
    setActiveId("");
  }, [pathname]);

  // 卸载时释放点击锁定挂在 window 上的监听(pin 对象引用稳定,cleanup 读到的是最新 release)
  useEffect(() => {
    const current = pin.current;
    return () => current.release();
  }, []);

  // 页面同时声明移动目录和桌面右缘目录，但任何时刻只运行可见的一份，
  // 避免 CSS 隐藏的实例继续扫描正文和监听滚动。
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1200px)");
    const compute = () => setEnabled(variant === "rail" ? wide.matches : !wide.matches);
    compute();
    wide.addEventListener("change", compute);
    return () => wide.removeEventListener("change", compute);
  }, [variant]);

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
    if (!enabled) {
      setItems([]);
      return;
    }
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
  }, [scan, containerSelector, pathname, enabled]);

  // 滚动高亮：最后一个顶部越过阅读线（顶栏下方）的小节即当前小节
  useEffect(() => {
    if (!enabled || !items.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      // 点击跳转期间高亮已锁定在目标小节,不参与滚动计算
      if (pin.current.id) return;
      // 阅读线对齐锚点的真实落点:落点由 html { scroll-padding-top } 决定,
      // 再留少量容差,保证点击跳转停稳后落点标题自己就是"当前小节"。
      const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
      const readingLine = (Number.isFinite(pad) ? pad : 92) + 8;
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= readingLine) current = item.id;
        else break;
      }
      // 已滚到页面底部时,最后一个小节永远够不到阅读线,直接视为当前小节
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        current = items[items.length - 1].id;
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
  }, [items, enabled]);

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

    // 立刻点亮所点小节并锁定,滚动途中不被中间小节抢走
    pin.current.release();
    pin.current.id = id;
    setActiveId(id);

    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);

    // 解锁时机:用户主动滚动(滚轮/触摸/滚动键)立即交还;否则等滚动停稳后,
    // 若正文加载(图片/翻译)把锚点顶离了落点,先瞬时校正一次再交还。
    let raf = 0;
    let lastY = window.scrollY;
    let still = 0;
    let corrected = false;
    const deadline = performance.now() + 2600;
    const teardown: Array<() => void> = [];
    const release = () => {
      pin.current.id = "";
      pin.current.release = () => {};
      cancelAnimationFrame(raf);
      teardown.forEach((off) => off());
      teardown.length = 0;
    };
    const onUserScroll = () => release();
    // 只有会滚动页面的按键才解除锁定,普通快捷键不算
    const onKeydown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) release();
    };
    pin.current.release = release;
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true });
    window.addEventListener("keydown", onKeydown);
    teardown.push(
      () => window.removeEventListener("wheel", onUserScroll),
      () => window.removeEventListener("touchstart", onUserScroll),
      () => window.removeEventListener("keydown", onKeydown)
    );

    const settle = () => {
      if (performance.now() > deadline) {
        release();
        return;
      }
      const y = window.scrollY;
      still = Math.abs(y - lastY) < 1 ? still + 1 : 0;
      lastY = y;
      if (still >= 4) {
        // 落点由 html { scroll-padding-top } 决定;若正文加载把锚点顶离该落点则校正
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const drift = el.getBoundingClientRect().top - pad;
        const canScroll = window.innerHeight + y < document.documentElement.scrollHeight - 2;
        if (!corrected && Math.abs(drift) > 6 && (drift < 0 || canScroll)) {
          corrected = true;
          el.scrollIntoView({ block: "start" });
          still = 0;
          raf = requestAnimationFrame(settle);
          return;
        }
        release();
        return;
      }
      raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
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

  // route-transition 的进入动画会让 transform 长期保留，从而成为 fixed
  // 元素的包含块。桌面目录必须 Portal 到 body，才能真正贴住视口右缘，
  // 而不是被整篇文章的高度和位置牵着走（AI 助手使用同一处理方式）。
  if (variant === "rail") {
    return createPortal(
      <aside className="article-toc-rail">
        {nav}
      </aside>,
      document.body
    );
  }

  return nav;
}
