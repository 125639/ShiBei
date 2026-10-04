import Image from "next/image";
import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { I18nText } from "@/components/I18nText";
import { resolveRequestLanguage } from "@/lib/i18n-server";
import { coverVariant } from "@/lib/reading-time";
import { Icon } from "./Icons";

export type PublicPostCardData = {
  id: string;
  slug: string;
  title: string;
  titleEn?: string | null;
  summary: string;
  summaryEn?: string | null;
  publishedAtIso: string | null;
  cover: string | null;
  minutes: number;
  topics: { id: string; name: string; slug: string }[];
  tags?: { id: string; name: string }[];
};

export function PostCard({
  post,
  featured = false,
  index = 0
}: {
  post: PublicPostCardData;
  featured?: boolean;
  index?: number;
}) {
  const language = resolveRequestLanguage();
  const topic = post.topics[0];
  const date = post.publishedAtIso
    ? new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "Asia/Shanghai"
      }).format(new Date(post.publishedAtIso))
    : null;

  return (
    <article className={`story-card${featured ? " story-card-featured" : ""}`} data-reveal>
      <div className={`story-art story-art-${coverVariant(post.slug)}`} aria-hidden="true">
        <span className="story-art-orbit" />
        <span className="story-art-shape" />
        <span className="story-art-line" />
        <span className="story-art-word">
          {["IDEAS", "PERSPECTIVE", "DISCOVER", "NOTES"][coverVariant(post.slug)]}
        </span>
        {post.cover ? (
          <Image
            src={post.cover}
            alt=""
            fill
            sizes={
              featured
                ? "(max-width: 700px) 100vw, 65vw"
                : "(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 33vw"
            }
            unoptimized={!post.cover.startsWith("/")}
            className="story-cover-image"
          />
        ) : null}
        <span className="story-art-number">{String(index + 1).padStart(2, "0")}</span>
        <span className="story-art-corner">
          <Icon name="arrow" />
        </span>
      </div>
      <div className="story-card-body">
        <div className="story-meta">
          {topic ? (
            <Link className="story-topic" href={`/posts?topic=${encodeURIComponent(topic.slug)}`}>
              {topic.name}
            </Link>
          ) : (
            <span className="story-topic">
              <I18nText zh="拾贝精选" en="ShiBei journal" />
            </span>
          )}
          {date ? <time dateTime={post.publishedAtIso!}>{date}</time> : null}
        </div>
        <h3>
          <Link className="story-title-link" href={`/posts/${post.slug}`}>
            <I18nText zh={post.title} en={post.titleEn || post.title} />
          </Link>
        </h3>
        <p className="story-summary">
          <I18nText zh={post.summary} en={post.summaryEn || post.summary} />
        </p>
        <div className="story-card-bottom">
          <span className="story-reading-time">
            <Icon name="clock" width="14" height="14" />
            <I18nText zh={`${post.minutes} 分钟阅读`} en={`${post.minutes} min read`} />
          </span>
          <span className="story-read-link" aria-hidden="true">
            <I18nText zh="读一读" en="Read story" />
            <Icon name="arrow" width="16" height="16" />
          </span>
        </div>
      </div>
    </article>
  );
}
