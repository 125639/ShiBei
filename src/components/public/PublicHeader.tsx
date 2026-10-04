"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Form from "next/form";
import { ActiveLink } from "@/components/ActiveLink";
import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { I18nText, useRouteLanguage } from "@/components/I18nTextClient";
import { withLanguagePrefix } from "@/lib/language";
import { Icon, ShellMark } from "./Icons";
import { useLanguageSwitch } from "@/components/useLanguageSwitch";

const NAV = [
  { href: "/", zh: "首页", en: "Home" },
  { href: "/posts", zh: "文章", en: "Stories" },
  { href: "/stats", zh: "数据", en: "Insights" },
  { href: "/community", zh: "社区", en: "Community" },
  { href: "/about", zh: "关于", en: "About" }
];
const SPACES = [
  {
    href: "/create",
    zh: "灵感共创",
    en: "Co-create",
    note: "让想法成为一篇文章",
    noteEn: "Turn an idea into a story"
  },
  {
    href: "/write",
    zh: "写作工作台",
    en: "Writing studio",
    note: "记录你的观察与思考",
    noteEn: "Make room for your words"
  },
  {
    href: "/settings",
    zh: "阅读设置",
    en: "Reading preferences",
    note: "找到舒服的阅读方式",
    noteEn: "Make yourself at home"
  }
];

export function PublicHeader({ siteName, appearance }: { siteName: string; appearance: ReactNode }) {
  const pathname = usePathname();
  const language = useRouteLanguage() || "zh";
  const english = language === "en";
  const { switchTo } = useLanguageSwitch();
  const [kind, setKind] = useState<"search" | "menu">("search");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousOverflow = useRef<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const unlock = useCallback(() => {
    if (previousOverflow.current !== null) {
      document.documentElement.style.overflow = previousOverflow.current;
      previousOverflow.current = null;
    }
  }, []);
  const open = useCallback((next: "search" | "menu", source?: HTMLElement) => {
    if (!dialog.current || dialog.current.open) return;
    trigger.current =
      source || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setKind(next);
    if (previousOverflow.current === null) previousOverflow.current = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog.current.showModal();
    if (next === "search")
      requestAnimationFrame(() => {
        if (dialog.current?.open) input.current?.focus();
      });
  }, []);
  const close = useCallback(() => {
    unlock();
    dialog.current?.close();
  }, [unlock]);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (document.querySelector("dialog[open]") && !dialog.current?.open) return;
      event.preventDefault();
      if (dialog.current?.open) close();
      else open("search");
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      unlock();
    };
  }, [close, open, unlock]);

  return (
    <>
      <header className="publication-header">
        <div className="publication-header-inner">
          <Link
            className="publication-brand"
            href="/"
            aria-label={`${siteName} · ${english ? "Home" : "首页"}`}
          >
            <ShellMark />
            <span>
              <strong>{siteName}</strong>
              <small>THE CURIOUS JOURNAL</small>
            </span>
          </Link>
          <nav className="publication-nav" aria-label={english ? "Primary navigation" : "主导航"}>
            {NAV.map((item) => (
              <ActiveLink key={item.href} href={item.href} match={item.href === "/" ? "exact" : "prefix"}>
                <I18nText zh={item.zh} en={item.en} />
                <span className="nav-active-dot" aria-hidden="true" />
              </ActiveLink>
            ))}
          </nav>
          <div className="publication-actions">
            <button
              className="publication-search-trigger"
              type="button"
              onClick={(event) => open("search", event.currentTarget)}
              aria-label={english ? "Search stories (Control or Command K)" : "搜索文章（Ctrl 或 Command K）"}
              aria-haspopup="dialog"
            >
              <Icon name="search" />
              <span>
                <I18nText zh="搜索" en="Search" />
              </span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="publication-appearance">{appearance}</div>
            <Link className="publication-write-link" href="/write">
              <Icon name="pen" width="16" height="16" />
              <I18nText zh="写点什么" en="Write a story" />
            </Link>
            <button
              className="publication-menu-trigger"
              type="button"
              onClick={(event) => open("menu", event.currentTarget)}
              aria-haspopup="dialog"
              aria-label={english ? "Open navigation menu" : "打开导航菜单"}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
      </header>
      <noscript>
        <nav className="publication-noscript" aria-label="Navigation">
          <Link href="/posts">文章 / Stories</Link>
          <Link href="/community">社区 / Community</Link>
          <Link href="/settings">设置 / Settings</Link>
          <Link href="/account">账户 / Account</Link>
        </nav>
      </noscript>
      <dialog
        ref={dialog}
        className={`publication-dialog publication-dialog-${kind}`}
        aria-labelledby="publication-dialog-title"
        onCancel={unlock}
        onClose={() => {
          if (!dialog.current?.open) {
            unlock();
            trigger.current?.focus({ preventScroll: true });
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }}
      >
        <div className="publication-dialog-head">
          <span className="publication-overline" id="publication-dialog-title">
            {kind === "search"
              ? english
                ? "FIND YOUR NEXT GOOD READ"
                : "发现下一篇好内容"
              : english
                ? "EXPLORE SHIBEI"
                : "探索拾贝"}
          </span>
          <button
            type="button"
            className="publication-icon-button"
            onClick={close}
            aria-label={english ? "Close dialog" : "关闭弹窗"}
          >
            <Icon name="close" />
          </button>
        </div>
        {kind === "search" ? (
          <>
            <Form
              className="publication-search-form"
              action={withLanguagePrefix(language, "/posts")}
              onSubmit={close}
            >
              <Icon name="search" width="25" height="25" />
              <input
                ref={input}
                type="search"
                name="q"
                required
                maxLength={120}
                aria-label={
                  english ? "Search titles, summaries, tags or topics" : "搜索标题、摘要、标签或主题"
                }
                placeholder={english ? "What are you curious about?" : "此刻，你对什么感到好奇？"}
                enterKeyHint="search"
              />
              <button
                type="submit"
                className="publication-icon-button"
                aria-label={english ? "Search" : "开始搜索"}
              >
                <Icon name="arrow" />
              </button>
            </Form>
            <p className="publication-search-hint">
              <I18nText
                zh="搜索文章标题、摘要、标签或主题，按 Enter 开始。"
                en="Search titles, summaries, tags or topics. Press Enter to explore."
              />
            </p>
          </>
        ) : (
          <nav className="publication-mobile-nav" aria-label={english ? "Main pages" : "主要页面"}>
            {NAV.map((item, index) => (
              <ActiveLink
                key={item.href}
                href={item.href}
                match={item.href === "/" ? "exact" : "prefix"}
                onClick={close}
              >
                <small>0{index + 1}</small>
                <I18nText zh={item.zh} en={item.en} />
                <Icon name="arrow" />
              </ActiveLink>
            ))}
          </nav>
        )}
        <div className="publication-dialog-spaces">
          {SPACES.map((item) => (
            <Link key={item.href} href={item.href} onClick={close}>
              <span>
                <strong>
                  <I18nText zh={item.zh} en={item.en} />
                </strong>
                <small>
                  <I18nText zh={item.note} en={item.noteEn} />
                </small>
              </span>
              <Icon name="arrow" width="17" height="17" />
            </Link>
          ))}
        </div>
        <div className="publication-dialog-footer">
          <Link href="/account" onClick={close}>
            <I18nText zh="登录 / 我的账户" en="Sign in / My account" />
          </Link>
          <Link href="/admin/login" onClick={close}>
            <I18nText zh="管理后台" en="Admin" />
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              switchTo(english ? "zh" : "en");
            }}
          >
            {english ? "中文" : "English"}
            <span aria-hidden="true"> ↗</span>
          </button>
        </div>
        <p className="publication-dialog-keyboard">
          <kbd>esc</kbd> <I18nText zh="关闭" en="to close" />
          <span>
            <kbd>tab</kbd> <I18nText zh="切换选项" en="to navigate" />
          </span>
        </p>
      </dialog>
    </>
  );
}
