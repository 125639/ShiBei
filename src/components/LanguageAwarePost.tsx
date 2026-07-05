"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { markdownToHtml, type VideoForShortcode } from "@/lib/markdown";
import { useUserPrefs } from "./useUserPrefs";
import { I18nText } from "./I18nText";
import { stripTitleHeading } from "@/lib/post-derive";

type PostText = {
  title: string;
  summary: string;
  content: string;
  titleEn?: string | null;
  summaryEn?: string | null;
  contentEn?: string | null;
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
  videosEnabled = true
}: {
  postId: string;
  post: PostText;
  contentLanguageMode: string;
  // 文章关联的视频。当正文里出现 [[video:ID]] 短代码时，对应位置渲染播放器。
  videos?: VideoForShortcode[];
  // 视频功能总开关（后台 设置→媒体）。false 时短代码被静默移除，页面完全无视频。
  videosEnabled?: boolean;
}) {
  const { prefs, hydrated } = useUserPrefs();
  const [translation, setTranslation] = useState<TranslationState>(() => ({
    title: post.titleEn || undefined,
    summary: post.summaryEn || undefined,
    content: post.contentEn || undefined,
    status: post.contentEn ? "ready" : "idle"
  }));
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
    if (!shouldLoadEnglish || post.contentEn) return;
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
  }, [postId, shouldLoadEnglish, post.contentEn]);

  // 页面头部（apple-article-header）已经展示过标题与摘要，这里默认不再重复；
  // 只有双语堆叠模式需要在每个语言块上方各自标出标题，帮助区分两段内容。
  if (!hydrated) {
    return <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} hideVideos={hideVideos} />;
  }

  if (showBilingual) {
    return (
      <div className="language-article-stack">
        <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} hideVideos={hideVideos} showHeading />
        <EnglishBlock translation={translation} fallbackTitle={post.title} videosById={videosById} hideVideos={hideVideos} showHeading />
      </div>
    );
  }

  if (wantsEnglish) {
    if (translation.status === "ready" && translation.content) {
      return <ArticleBlock label="English" title={translation.title || post.title} summary={translation.summary || post.summary} content={translation.content} videosById={videosById} hideVideos={hideVideos} />;
    }
    return <EnglishBlock translation={translation} fallbackTitle={post.title} videosById={videosById} hideVideos={hideVideos} />;
  }

  return <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} hideVideos={hideVideos} />;
}

function ArticleBlock({
  label,
  title,
  summary,
  content,
  videosById,
  hideVideos = false,
  showHeading = false
}: {
  label: React.ReactNode;
  title: string;
  summary: string;
  content: string;
  videosById?: Map<string, VideoForShortcode>;
  hideVideos?: boolean;
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
          <p>{summary}</p>
        </>
      ) : null}
      {/* 页头（或双语块头）已经渲染过标题，正文若以同一标题的 H1 开头则剥掉，避免重复 */}
      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(stripTitleHeading(content, title), { videosById, hideVideos }) }} />
    </div>
  );
}

function EnglishBlock({ translation, fallbackTitle, videosById, hideVideos = false, showHeading = false }: { translation: TranslationState; fallbackTitle: string; videosById?: Map<string, VideoForShortcode>; hideVideos?: boolean; showHeading?: boolean }) {
  if (translation.status === "ready" && translation.content) {
    return (
      <ArticleBlock
        label="English"
        title={translation.title || fallbackTitle}
        summary={translation.summary || ""}
        content={translation.content}
        videosById={videosById}
        hideVideos={hideVideos}
        showHeading={showHeading}
      />
    );
  }

  return (
    <div className="form-card translation-status" aria-busy={translation.status === "loading"}>
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
