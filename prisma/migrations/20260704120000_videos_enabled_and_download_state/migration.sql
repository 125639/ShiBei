-- 视频功能改造：
-- 1. SiteSettings.videosEnabled — 视频功能总开关。默认关闭：前台不渲染任何视频，
--    worker 也不再自动收集视频链接。
-- 2. Video.downloadStatus / downloadError — 管理员触发「下载到本地」后的后台任务
--    状态（queued / running / failed；成功后清空并转为 LOCAL 类型）。

ALTER TABLE "SiteSettings" ADD COLUMN "videosEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Video" ADD COLUMN "downloadStatus" VARCHAR(16);
ALTER TABLE "Video" ADD COLUMN "downloadError" TEXT;
