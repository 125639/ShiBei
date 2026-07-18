import type { Video } from "@prisma/client";
import { hostFromUrl as hostFromUrlOrNull } from "./html";
import {
  EMBED_IFRAME_SANDBOX,
  formatVideoDuration,
  isAllowedEmbedUrl,
  safeHttpHref,
  shouldRenderVideoAsLink
} from "./video-display";

type VideoAttribution = Pick<Video, "title" | "type" | "url"> & {
  displayMode?: string | null;
  attribution?: string | null;
  sourcePageUrl?: string | null;
  sourcePlatform?: string | null;
  durationSec?: number | null;
};

export function VideoEmbed({ video }: { video: VideoAttribution }) {
  const renderAsLink = shouldRenderVideoAsLink(video) || (video.type === "EMBED" && !isAllowedEmbedUrl(video.url));
  // 只有 http/https 与站内相对路径能成为可点击 href。视频 url / sourcePageUrl 可能来自
  // 同步包或抓取，未必都做过 scheme 校验；javascript:/data:/vbscript: 等落到 <a href>
  // 就是点击型 XSS，这里在渲染处统一收口，非安全值一律降级为不可点击文本。
  const linkHref = safeHttpHref(video.url);
  const sourceHref = safeHttpHref(video.sourcePageUrl);

  return (
    <div className="video-embed">
      {renderAsLink && (() => {
        // EMBED 型视频以卡片展示时，人点出去应到平台观看页（sourcePageUrl，如
        // youtube.com/watch），而不是 /embed/ 裸播放器 URL；LINK 型的 url 本身
        // 就是可播放资源，维持原值。
        const cardHref = (video.type === "EMBED" ? sourceHref : null) ?? linkHref;
        return cardHref ? (
          <a className="video-link-card" href={cardHref} target="_blank" rel="noreferrer">
            <span>{video.title}</span>
            <strong>打开视频</strong>
          </a>
        ) : (
          <div className="video-link-card"><span>{video.title}</span></div>
        );
      })()}
      {!renderAsLink && video.type === "LOCAL" && <video controls src={video.url} className="video-frame" preload="metadata" />}
      {!renderAsLink && video.type === "EMBED" && (
        <iframe
          className="video-frame"
          title={video.title}
          src={video.url}
          sandbox={EMBED_IFRAME_SANDBOX}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      )}
      {!renderAsLink && video.type === "LINK" && linkHref && (
        <a className="text-link" href={linkHref} target="_blank" rel="noreferrer">
          打开视频资源
        </a>
      )}
      <div className="article-media-caption video-caption"><span>{video.title}</span></div>

      {!renderAsLink && video.type === "LOCAL" && sourceHref && (
        <a className="video-hd-cta" href={sourceHref} target="_blank" rel="noreferrer">
          <span>本站仅为低码率存档副本，供网络受限时观看</span>
          <strong>到源站看高清完整报道 →</strong>
        </a>
      )}

      {(sourceHref || video.attribution || video.sourcePlatform) && (
        <div className="video-attribution">
          {video.sourcePlatform && (
            <div>
              <strong>视频平台</strong>：{video.sourcePlatform}
              {typeof video.durationSec === "number" && video.durationSec > 0
                ? ` · 时长 ${formatVideoDuration(video.durationSec)}`
                : ""}
            </div>
          )}
          {sourceHref && (
            <div>
              <strong>来源页面</strong>：{" "}
              <a className="text-link" href={sourceHref} target="_blank" rel="noreferrer">
                {hostFromUrl(sourceHref)}
              </a>
            </div>
          )}
          {video.attribution && (
            <details className="video-source-details">
              <summary>版权与来源说明</summary>
              <div>{video.attribution}</div>
            </details>
          )}
          <div className="video-copyright-note">
            视频内容版权归原作者所有，本站仅做信息整理与档案存档之用。
          </div>
        </div>
      )}
    </div>
  );
}

function hostFromUrl(url: string) {
  return hostFromUrlOrNull(url) || "来源页面";
}
