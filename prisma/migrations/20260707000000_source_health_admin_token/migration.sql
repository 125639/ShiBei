-- Source 连续失败计数（成功清零，达阈值自动 PAUSED）
ALTER TABLE "Source" ADD COLUMN "failStreak" INTEGER NOT NULL DEFAULT 0;

-- AdminUser token 版本号：登出/改密 +1，令已签发的 JWT 立即失效
ALTER TABLE "AdminUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
