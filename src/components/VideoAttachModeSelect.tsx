import { I18nText } from "@/components/I18nText";

/**
 * 生成任务表单里的"视频模式"选择器：本单覆盖站点默认（设置→媒体）。
 * 空值=跟随站点默认（FetchJob.videoAttachMode 存 NULL）。
 */
export function VideoAttachModeSelect({ id }: { id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}><I18nText zh="视频模式" en="Video mode" /></label>
      <select id={id} name="videoAttachMode" defaultValue="">
        <option value="">跟随站点默认 / Site default</option>
        <option value="embed">外链嵌入播放器 / Embed external player</option>
        <option value="link">仅链接卡片 / Link card only</option>
        <option value="download">下载到本地（480p）/ Download locally (480p)</option>
        <option value="off">本次不挂视频 / No videos</option>
      </select>
      <small className="muted">
        <I18nText
          zh="读者无法直连 YouTube 等平台时选「下载到本地」：视频缓存到本站后直接用本地播放器播放。"
          en="Pick “Download locally” when readers cannot reach YouTube etc.: cached copies play from this site."
        />
      </small>
    </div>
  );
}
