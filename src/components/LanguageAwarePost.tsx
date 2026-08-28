"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VideoForShortcode } from "@/lib/markdown";
import { useMarkdownHtml } from "./useMarkdownHtml";
import { useUserPrefs } from "./useUserPrefs";
import { I18nText } from "./I18nText";
import { stripTitleHeading, summaryDuplicatesContentLead } from "@/lib/post-derive";

type PostText = {
  title: string;
  summary: string;
  titleEn?: string | null;
  summaryEn?: string | null;
};

type TranslationState = {
  title?: string;
  summary?: string;
  content?: string;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

export function LanguageAwarePost({
  postId,
  post,
  contentLanguageMode,
  videos,
  videosEnabled = true,
  zhContentHtml,
  enContentHtml = null,
  showZhLead,
  showEnLead
}: {
  postId: string;
  post: PostText;
  contentLanguageMode: string;
  // 文章关联的视频。正文短代码已由服务端渲染进 zh/enContentHtml；这里保留
  // 视频数据只为「翻译动态到达后客户端补解析」这条少数路径服务。
  videos?: VideoForShortcode[];
  // 视频功能总开关（后台 设置→媒体）。false 时短代码被静默移除，页面完全无视频。
  videosEnabled?: boolean;
  // 服务端预渲染好的中文正文 HTML（含标题剥离、视频短代码处理）。
  // 客户端不再引入 marked/DOMPurify：纯中文读者零解析器下载、零重复解析，
  // 正文也不再随 hydration/prefs 变化在浏览器里被反复 parse+sanitize。
  zhContentHtml: string;
  // 库中已有英文版（contentEn）时由服务端一并渲染好的英文正文 HTML；
  // 英文读者命中缓存翻译时同样不需要下载解析器 chunk。null 表示库中没有。
  enContentHtml?: string | null;
  // 「摘要是否复读了正文导语」由服务端算好后以布尔传入。
  //
  // 此前这里接收的是 post.content / post.contentEn 两份**完整 markdown 原文**，
  // 仅仅为了在 ArticleBlock 里调一次 summaryDuplicatesContentLead()。作为
  // 客户端组件的 prop，它们会被完整序列化进内嵌的 RSC Flight 负载——正文
  // 已经在 SSR 的 DOM 里有一份，Flight 里再来两份原文，一篇文章的页面响应
  // 因此携带数倍于正文本身的字节。布尔值的代价是 4 个字符。
  showZhLead: boolean;
  showEnLead: boolean;
}) {
  const { prefs, hydrated } = useUserPrefs();
  const hasServerEnglish = enContentHtml !== null;
  const [translation, setTranslation] = useState<TranslationState>(() => ({ status: "idle" }));
  const wantsEnglish = hydrated && prefs.language === "en";
  const showBilingual = contentLanguageMode === "bilingual";
  const shouldLoadEnglish = wantsEnglish || showBilingual;

  const videosById = useMemo(() => {
    const map = new Map<string, VideoForShortcode>();
    (videos || []).forEach((video) => map.set(video.id, video));
    return map;
  }, [videos]);
  const hideVideos = videosEnabled === false;

  // 加载英文版：一次 effect 内自驱动轮询（202 pending → 定时重试）。
  // 不把 translation.status 放进依赖——effect 开头就会改 status，若在依赖里，
  // 变更会触发 cleanup 把 cancelled 置真，进行中的响应全被丢弃，
  // 表现为"翻译永远转圈，刷新后才出现"。
  useEffect(() => {
    // 服务端已经渲染好英文正文时不需要再请求。
    if (!shouldLoadEnglish || hasServerEnglish) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const MAX_POLLS = 40; // 3s 间隔 ≈ 最多等 2 分钟，超时提示稍后刷新

    async function load() {
      setTranslation((current) => (current.content ? current : { ...current, status: "loading", error: undefined }));
      try {
        const response = await fetch(`/api/public/posts/${encodeURIComponent(postId)}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLanguage: "en" })
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (response.status === 202 && data?.pending) {
          attempts += 1;
          if (attempts >= MAX_POLLS) {
            setTranslation((current) => ({
              ...current,
              status: "error",
              error: "翻译仍在生成中，请稍后刷新页面查看"
            }));
            return;
          }
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delaySec = Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 2), 10) : 3;
          timer = setTimeout(load, delaySec * 1000);
          return;
        }

        if (!response.ok) throw new Error(data.error || "Translation failed");
        setTranslation({
          title: String(data.title || ""),
          summary: String(data.summary || ""),
          content: String(data.content || ""),
          status: "ready"
        });
      } catch (error) {
        if (!cancelled) {
          setTranslation((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [postId, shouldLoadEnglish, hasServerEnglish]);

  // 翻译在客户端动态到达时才懒加载 markdown 解析器（useMarkdownHtml 内部
  // dynamic import）。两种情况不下载：页面 SSR 时库中已有英文版
  // （enContentHtml 覆盖），或访客根本没切到英文/双语模式。
  const dynamicEnInput =
    !hasServerEnglish && translation.status === "ready" && translation.content
      ? stripTitleHeading(translation.content, translation.title || post.title)
      : null;
  const dynamicEnHtml = useMarkdownHtml(dynamicEnInput, videosById, hideVideos);

  // 动态翻译到达时，正文原文本来就在客户端内存里（来自 fetch 响应），
  // 在这里算导语重复与否不产生任何额外传输。
  const dynamicEnShowLead =
    translation.content && translation.summary
      ? !summaryDuplicatesContentLead(
          translation.content,
          translation.title || post.title,
          translation.summary
        )
      : false;

  // 页面头部（apple-article-header）已经展示过标题与摘要，这里默认不再重复；
  // 只有双语堆叠模式需要在每个语言块上方各自标出标题，帮助区分两段内容。
  const zhBlock = (showHeading: boolean) => (
    <ArticleBlock
      label={<I18nText zh="中文" en="Chinese" />}
      title={post.title}
      summary={post.summary}
      html={zhContentHtml}
      showLead={showZhLead}
      showHeading={showHeading}
    />
  );

  if (!hydrated) {
    return zhBlock(false);
  }

  if (showBilingual) {
    return (
      <div className="language-article-stack">
        {zhBlock(true)}
        {hasServerEnglish ? (
          <ArticleBlock
            label="English"
            title={post.titleEn || post.title}
            summary={post.summaryEn || post.summary}
            html={enContentHtml as string}
            showLead={showEnLead}
            showHeading
          />
        ) : (
          <EnglishBlock
            translation={translation}
            fallbackTitle={post.title}
            html={dynamicEnHtml}
            showLead={dynamicEnShowLead}
            showHeading
          />
        )}
      </div>
    );
  }

  if (wantsEnglish) {
    if (hasServerEnglish) {
      return (
        <ArticleBlock
          label="English"
          title={post.titleEn || post.title}
          summary={post.summaryEn || post.summary}
          html={enContentHtml as string}
          showLead={showEnLead}
        />
      );
    }
    if (translation.status === "ready" && translation.content) {
      if (dynamicEnHtml !== null) {
        return (
          <ArticleBlock
            label="English"
            title={translation.title || post.title}
            summary={translation.summary || post.summary}
            html={dynamicEnHtml}
            showLead={dynamicEnShowLead}
          />
        );
      }
      // 解析器 chunk 尚在下载——只出现在「首次生成翻译后的瞬间」，通常几十毫秒。
      return (
        <EnglishBlock
          translation={{ ...translation, status: "loading" }}
          fallbackTitle={post.title}
          html={null}
          showLead={false}
          parsing
        />
      );
    }
    return (
      <EnglishBlock
        translation={translation}
        fallbackTitle={post.title}
        html={null}
        showLead={false}
      />
    );
  }

  return zhBlock(false);
}

function ArticleBlock({
  label,
  title,
  summary,
  html,
  showLead,
  showHeading = false
}: {
  label: React.ReactNode;
  title: string;
  summary: string;
  /** 已渲染好的正文 HTML（服务端预渲染或客户端懒加载产出）。 */
  html: string;
  /** 摘要是否值得单独作为导语展示（false = 与正文首段重复）。 */
  showLead: boolean;
  showHeading?: boolean;
}) {
  const dataLabel = typeof label === 'string' ? label.toLowerCase() : 'localized';
  return (
    <div className="localized-article" data-language-block={dataLabel}>
      {showHeading ? (
        <>
          <span className="tag">{label}</span>
          {/* 页面级 h1 在文章页头；语言块内用 h2 保持大纲层级正确 */}
          <h2 className="language-block-title">{title}</h2>
          {summary && showLead ? <p>{summary}</p> : null}
        </>
      ) : null}
      {/* 页头（或双语块头）已经渲染过标题，正文的重复 H1 已在服务端剥掉 */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function EnglishBlock({
  translation,
  fallbackTitle,
  html,
  showLead,
  parsing = false,
  showHeading = false
}: {
  translation: TranslationState;
  fallbackTitle: string;
  html: string | null;
  showLead: boolean;
  parsing?: boolean;
  showHeading?: boolean;
}) {
  if (translation.status === "ready" && translation.content) {
    if (html !== null) {
      return (
        <ArticleBlock
          label="English"
          title={translation.title || fallbackTitle}
          summary={translation.summary || ""}
          html={html}
          showLead={showLead}
          showHeading={showHeading}
        />
      );
    }
    return (
      <div className="form-card translation-status" aria-busy="true">
        <span className="tag">English</span>
        <h2>English version</h2>
        <p className="muted-block" role="status"><I18nText zh="正在准备排版…" en="Preparing layout…" /></p>
      </div>
    );
  }

  return (
    <div className="form-card translation-status" aria-busy={translation.status === "loading" || parsing}>
      <span className="tag">English</span>
      <h2>English version</h2>
      {translation.status === "error" ? (
        <p className="muted-block" role="alert"><I18nText zh={`英文翻译暂时失败：${translation.error}`} en={`Translation failed: ${translation.error}`} /></p>
      ) : (
        <p className="muted-block" role="status"><I18nText zh="正在调用 AI 生成英文版本。首次打开可能需要等待一会儿，完成后会缓存到文章中。" en="Calling AI to generate English version. It may take a moment on first open, and will be cached afterwards." /></p>
      )}
      <Link className="text-link" href="/settings"><I18nText zh="调整语言设置" en="Adjust Language Settings" /></Link>
    </div>
  );
}
