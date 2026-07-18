-- 视频挂载模式：站点默认（SiteSettings.videoAttachMode）+ 每次生成的按单覆盖
-- （FetchJob.videoAttachMode，NULL=跟随站点默认）。
-- 取值：embed 外链嵌入 / link 链接卡片 / download 下载本地(480p) / off 不挂视频。
ALTER TABLE "SiteSettings" ADD COLUMN "videoAttachMode" TEXT NOT NULL DEFAULT 'embed';
ALTER TABLE "FetchJob" ADD COLUMN "videoAttachMode" TEXT;
