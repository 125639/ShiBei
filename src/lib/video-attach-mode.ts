/**
 * 视频抓取/挂载模式：决定自动流程（关键词研究、网页抓取、专题速递）发现的相关
 * 视频以什么形态进入文章。站点级默认存 SiteSettings.videoAttachMode，每次生成
 * 可在任务表单里按单覆盖（FetchJob.videoAttachMode，空=跟随站点默认），成稿后
 * 还可以在 后台→视频管理 对单支视频改展示方式或触发下载。
 *
 * - embed    外链嵌入：平台 iframe 播放器（YouTube 等）。观众须能直连该平台。
 * - link     链接卡片：不内嵌播放器，只给来源链接卡片。最保守、零外源加载。
 * - download 下载本地：先按 embed 挂上，随即排入 480p 下载队列，完成后转为
 *            本站 <video> 播放——观众无法直连外网平台（墙内）时的可看形态。
 * - off      本次生成不挂任何视频。
 */
export const VIDEO_ATTACH_MODES = ["embed", "link", "download", "off"] as const;
export type VideoAttachMode = (typeof VIDEO_ATTACH_MODES)[number];

export function normalizeVideoAttachMode(value: unknown): VideoAttachMode | null {
  const v = String(value ?? "").trim().toLowerCase();
  return (VIDEO_ATTACH_MODES as readonly string[]).includes(v) ? (v as VideoAttachMode) : null;
}

/** 任务覆盖优先，其次站点默认，双空回落 embed（历史行为）。 */
export function resolveVideoAttachMode(
  jobMode: string | null | undefined,
  siteMode: string | null | undefined
): VideoAttachMode {
  return normalizeVideoAttachMode(jobMode) ?? normalizeVideoAttachMode(siteMode) ?? "embed";
}
