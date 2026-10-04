"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { I18nText, useRouteLanguage } from "@/components/I18nTextClient";
import { readingProgress } from "@/lib/reading-time";
import { Icon } from "./Icons";

const subscribeMounted = () => () => {};

export function ReadingTools({ minutes }: { minutes: number }) {
  const english = useRouteLanguage() === "en";
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const mounted = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false
  );

  useEffect(() => {
    const article = document.querySelector<HTMLElement>("[data-reading-content]");
    if (!article) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = article.getBoundingClientRect();
      setProgress(readingProgress(bounds.top, bounds.height, window.innerHeight));
      setVisible(bounds.top < 120 && bounds.bottom > 100);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    // Re-measure for lazy images, video sizing and asynchronously arriving translations.
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    resize?.observe(article);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    const url = window.location.href.split("#")[0];
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFallback("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setFallback(url);
      requestAnimationFrame(() => {
        fallbackInput.current?.focus();
        fallbackInput.current?.select();
      });
    }
  }
  function top() {
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.siteMotion === "paused";
    window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
  }

  const dock = (
    <div className="publication-reading-dock" hidden={!visible}>
      <span>
        <I18nText zh="阅读进度" en="Reading" /> {progress}%
      </span>
      <div
        className="publication-reading-meter"
        role="progressbar"
        aria-label={english ? "Article reading progress" : "文章阅读进度"}
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <button type="button" onClick={top} aria-label={english ? "Back to top" : "回到顶部"}>
        <Icon name="up" width="15" height="15" />
      </button>
    </div>
  );
  return (
    <>
      <div className="publication-reading-tools">
        <span className="publication-reading-estimate">
          <Icon name="clock" width="16" height="16" />
          <I18nText zh={`约 ${minutes} 分钟读完`} en={`${minutes} min read`} />
        </span>
        <button className="publication-copy" type="button" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} width="15" height="15" />
          <I18nText
            zh={copied ? "链接已复制" : "分享这篇文章"}
            en={copied ? "Link copied" : "Share this story"}
          />
        </button>
      </div>
      <span className={fallback ? "publication-share-message" : "sr-only"} role="status">
        {fallback
          ? english
            ? "Clipboard is unavailable. Copy the selected link below."
            : "无法访问剪贴板，请手动复制下方链接。"
          : copied
            ? english
              ? "Article link copied to clipboard"
              : "文章链接已复制到剪贴板"
            : ""}
      </span>
      {fallback ? (
        <input
          ref={fallbackInput}
          className="publication-copy-fallback"
          readOnly
          value={fallback}
          aria-label={english ? "Article link to copy" : "可复制的文章链接"}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {mounted ? createPortal(dock, document.body) : null}
    </>
  );
}
