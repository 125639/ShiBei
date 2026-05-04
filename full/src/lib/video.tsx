import type { Video } from "@prisma/client";

type VideoAttribution = Pick<Video, "title" | "type" | "url"> & {
  attribution?: string | null;
  sourcePageUrl?: string | null;
  sourcePlatform?: string | null;
  durationSec?: number | null;
};

export function VideoEmbed({ video }: { video: VideoAttribution }) {
  return (
    <div>
      {video.type === "LOCAL" && <video controls src={video.url} className="video-frame" preload="metadata" />}
      {video.type === "EMBED" && (
        <iframe
          className="video-frame"
          title={video.title}
          src={video.url}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      )}
      {video.type === "LINK" && (
        <a className="text-link" href={video.url} target="_blank" rel="noreferrer">
          打开视频资源
        </a>
      )}

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
                {video.sourcePageUrl}
              </a>
            </div>
          )}
          {video.attribution && (
            <div style={{ marginTop: 6, whiteSpace: "pre-line" }}>{video.attribution}</div>
          )}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            视频内容版权归原作者所有，本站仅做信息整理与档案存档之用。
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
