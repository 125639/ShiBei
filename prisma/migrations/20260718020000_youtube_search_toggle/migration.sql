-- YouTube 相关视频搜索独立开关（默认开，保持现网行为不变）。
-- 墙内部署 YouTube 不可达时，管理员在 设置→媒体 关掉即可省去每篇文章 ≤25s 的搜索超时。
ALTER TABLE "SiteSettings" ADD COLUMN "youtubeSearchEnabled" BOOLEAN NOT NULL DEFAULT true;
