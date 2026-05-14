import type { Video } from "@prisma/client";
import { shouldRenderVideoAsLink } from "./video-display";

type VideoAttribution = Pick<Video, "title" | "type" | "url"> & {
  displayMode?: string | null;
  attribution?: string | null;
  sourcePageUrl?: string | null;
  sourcePlatform?: string | null;
  durationSec?: number | null;
};

export function VideoEmbed({ video }: { video: VideoAttribution }) {
  return (
    <div className="video-embed">
      {shouldRenderVideoAsLink(video) && (
        <a className="video-link-card" href={video.url} target="_blank" rel="noreferrer">
          <span>{video.title}</span>
          <strong>打开视频</strong>
        </a>
      )}
      {!shouldRenderVideoAsLink(video) && video.type === "LOCAL" && <video controls src={video.url} className="video-frame" preload="metadata" />}
      {!shouldRenderVideoAsLink(video) && video.type === "EMBED" && (
        <iframe
          className="video-frame"
          title={video.title}
          src={video.url}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      )}
      {!shouldRenderVideoAsLink(video) && video.type === "LINK" && (
        <a className="text-link" href={video.url} target="_blank" rel="noreferrer">
          打开视频资源
        </a>
      )}
      <div className="article-media-caption video-caption"><span>{video.title}</span></div>

      {(video.sourcePageUrl || video.attribution || video.sourcePlatform) && (
        <div className="video-attribution">
          {video.sourcePlatform && (
            <div>
              <strong>视频平台</strong>：{video.sourcePlatform}
              {typeof video.durationSec === "number" && video.durationSec > 0
                ? ` · 时长 ${formatDuration(video.durationSec)}`
                : ""}
            </div>
          )}
          {video.sourcePageUrl && (
            <div>
              <strong>来源页面</strong>：{" "}
              <a className="text-link" href={video.sourcePageUrl} target="_blank" rel="noreferrer">
                {hostFromUrl(video.sourcePageUrl)}
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
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "来源页面";
  }
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
