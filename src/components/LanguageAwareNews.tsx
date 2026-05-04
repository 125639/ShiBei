"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { markdownToHtml, type VideoForShortcode } from "@/lib/markdown";
import { useUserPrefs } from "./useUserPrefs";
import { I18nText } from "./I18nText";

type NewsText = {
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

export function LanguageAwareNews({
  postId,
  post,
  newsLanguageMode,
  videos
}: {
  postId: string;
  post: NewsText;
  newsLanguageMode: string;
  // 文章关联的视频。当正文里出现 [[video:ID]] 短代码时，对应位置渲染播放器。
  videos?: VideoForShortcode[];
}) {
  const { prefs, hydrated } = useUserPrefs();
  const [translation, setTranslation] = useState<TranslationState>(() => ({
    title: post.titleEn || undefined,
    summary: post.summaryEn || undefined,
    content: post.contentEn || undefined,
    status: post.contentEn ? "ready" : "idle"
  }));
  const wantsEnglish = hydrated && prefs.language === "en";
  const showBilingual = newsLanguageMode === "bilingual";
  const shouldLoadEnglish = wantsEnglish || showBilingual;

  const videosById = useMemo(() => {
    const map = new Map<string, VideoForShortcode>();
    (videos || []).forEach((video) => map.set(video.id, video));
    return map;
  }, [videos]);

  useEffect(() => {
    if (!shouldLoadEnglish || translation.content || translation.status === "loading") return;
    let cancelled = false;
    setTranslation((current) => ({ ...current, status: "loading", error: undefined }));
    fetch(`/api/public/posts/${encodeURIComponent(postId)}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguage: "en" })
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Translation failed");
        return data as { title: string; summary: string; content: string };
      })
      .then((data) => {
        if (!cancelled) setTranslation({ ...data, status: "ready" });
      })
      .catch((error) => {
        if (!cancelled) {
          setTranslation((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [postId, shouldLoadEnglish, translation.content, translation.status]);

  if (!hydrated) {
    return <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} />;
  }

  if (showBilingual) {
    return (
      <div className="language-article-stack">
        <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} />
        <EnglishBlock translation={translation} fallbackTitle={post.title} videosById={videosById} />
      </div>
    );
  }

  if (wantsEnglish) {
    if (translation.status === "ready" && translation.content) {
      return <ArticleBlock label="English" title={translation.title || post.title} summary={translation.summary || post.summary} content={translation.content} videosById={videosById} />;
    }
    return <EnglishBlock translation={translation} fallbackTitle={post.title} videosById={videosById} />;
  }

  return <ArticleBlock label={<I18nText zh="中文" en="Chinese" />} title={post.title} summary={post.summary} content={post.content} videosById={videosById} />;
}

function ArticleBlock({ label, title, summary, content, videosById }: { label: React.ReactNode; title: string; summary: string; content: string; videosById?: Map<string, VideoForShortcode> }) {
  const dataLabel = typeof label === 'string' ? label.toLowerCase() : 'localized';
  return (
    <div className="localized-article" data-language-block={dataLabel}>
      <span className="tag">{label}</span>
      <h1>{title}</h1>
      <p>{summary}</p>
      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(content, { videosById }) }} />
    </div>
  );
}

function EnglishBlock({ translation, fallbackTitle, videosById }: { translation: TranslationState; fallbackTitle: string; videosById?: Map<string, VideoForShortcode> }) {
  if (translation.status === "ready" && translation.content) {
    return (
      <ArticleBlock
        label="English"
        title={translation.title || fallbackTitle}
        summary={translation.summary || ""}
        content={translation.content}
        videosById={videosById}
      />
    );
  }

  return (
    <div className="form-card translation-status">
      <span className="tag">English</span>
      <h2>English version</h2>
      {translation.status === "error" ? (
        <p className="muted-block"><I18nText zh={`英文翻译暂时失败：${translation.error}`} en={`Translation failed: ${translation.error}`} /></p>
      ) : (
        <p className="muted-block"><I18nText zh="正在调用 AI 生成英文版本。首次打开可能需要等待一会儿，完成后会缓存到文章中。" en="Calling AI to generate English version. It may take a moment on first open, and will be cached afterwards." /></p>
      )}
      <Link className="text-link" href="/settings"><I18nText zh="调整语言设置" en="Adjust Language Settings" /></Link>
    </div>
  );
}
