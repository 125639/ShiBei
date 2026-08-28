-- Bilibili 相关视频搜索开关（默认开）：B 站 iframe 墙内直连可嵌，国内受众首选视频源。
ALTER TABLE "SiteSettings" ADD COLUMN "bilibiliSearchEnabled" BOOLEAN NOT NULL DEFAULT true;
-- yt-dlp 下载用 cookies.txt（加密存储）：解 YouTube 对数据中心 IP 的取流登录墙。
ALTER TABLE "SiteSettings" ADD COLUMN "ytDlpCookiesEnc" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "ytDlpCookiesUpdatedAt" TIMESTAMP(3);
