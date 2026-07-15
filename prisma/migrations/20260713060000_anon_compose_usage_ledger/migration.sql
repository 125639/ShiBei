-- 匿名 AI 成稿额度必须记录“已经发生的生成事件”，不能依赖仍存活的作品行；
-- 否则删除草稿即可恢复额度并无限生成。workId 不设外键，作品删除后账本保留。
CREATE TABLE "AnonymousComposeUsage" (
  "id" TEXT NOT NULL,
  "clientIp" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnonymousComposeUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnonymousComposeUsage_workId_key"
ON "AnonymousComposeUsage"("workId");

CREATE INDEX "AnonymousComposeUsage_clientIp_createdAt_idx"
ON "AnonymousComposeUsage"("clientIp", "createdAt");

-- 为迁移前仍存在的匿名成稿补记一次用量。ID 使用原作品 ID 构造且不会泄露到 API；
-- clientIp 为空的历史行原本也无法参与按 IP 计数，因此不凭空归到 unknown。
INSERT INTO "AnonymousComposeUsage" ("id", "clientIp", "workId", "createdAt")
SELECT
  'legacy_' || "id",
  "clientIp",
  "id",
  COALESCE("draftGeneratedAt", "createdAt")
FROM "CreativeWork"
WHERE "ownerId" IS NULL
  AND "clientIp" IS NOT NULL
  AND "draftGeneratedAt" IS NOT NULL
ON CONFLICT ("workId") DO NOTHING;
