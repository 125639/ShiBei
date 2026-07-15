ALTER TABLE "Post" ADD COLUMN "publicationBlockedReason" TEXT;
ALTER TABLE "Post" ADD COLUMN "pendingRevision" JSONB;
ALTER TABLE "RawItem" ADD COLUMN "artifactKind" VARCHAR(32);

-- Older admin forms accepted a complete endpoint. Store the reusable base so
-- probe and real generation resolve to the exact same request path.
UPDATE "ModelConfig"
SET "baseUrl" = regexp_replace("baseUrl", '/(?:chat/completions|models)/?$', '', 'i')
WHERE "baseUrl" ~* '/(?:chat/completions|models)/?$';

-- FetchJob records are periodically cleaned, so persist the exceptional VIDEO
-- artifact kind on RawItem itself before that relation can become NULL.
UPDATE "RawItem" AS raw
SET "artifactKind" = 'VIDEO'
FROM "FetchJob" AS job
WHERE raw."fetchJobId" = job."id" AND job."sourceType" = 'VIDEO';

UPDATE "RawItem"
SET "artifactKind" = 'VIDEO'
WHERE "artifactKind" IS NULL
  AND "fetchJobId" IS NULL
  AND "markdown" ~ E'^# [^\\n]+\\n\\n视频来源：https?://[^[:space:]]+[[:space:]]*$'
  AND "content" ~ E'^[^\\n]+\\nhttps?://[^[:space:]]+[[:space:]]*$';

-- Backfill historical diagnostic/fallback drafts. These strings were emitted by
-- the worker before the structured block state existed. A blocked row must never
-- remain public, even if an older worker or an administrator published it.
UPDATE "Post"
SET "publicationBlockedReason" = CASE
  WHEN "summary" LIKE '%资料未达到发布门槛%'
    OR "content" LIKE '%资料未达到发布门槛%'
    OR "summary" LIKE '%资料未达到定时报发布门槛%'
    OR "content" LIKE '%资料未达到定时报发布门槛%'
    THEN '研究资料未达到发布门槛'
  WHEN "summary" LIKE '%未配置模型或内容风格%' OR "content" LIKE '%未配置模型或内容风格%'
    THEN '未配置模型或内容风格'
  ELSE 'AI 内容生成请求未完成'
END
WHERE
  "rawItemId" IS NOT NULL
  AND (
    "summary" LIKE 'AI 内容生成请求未完成%'
    OR "content" LIKE '%> AI 内容生成请求未完成：%'
    OR "summary" LIKE 'AI 日报请求未完成%'
    OR "content" LIKE '%> AI 日报请求未完成：%'
    OR "summary" LIKE 'AI 周报请求未完成%'
    OR "content" LIKE '%> AI 周报请求未完成：%'
    OR "summary" LIKE 'AI 每日要闻请求未完成%'
    OR "content" LIKE '%> AI 每日要闻请求未完成：%'
    OR "summary" LIKE 'AI 周报综述请求未完成%'
    OR "content" LIKE '%> AI 周报综述请求未完成：%'
    OR "summary" LIKE '资料未达到发布门槛%'
    OR "content" LIKE '%> 资料未达到发布门槛：%'
    OR "summary" LIKE '资料未达到定时报发布门槛%'
    OR "content" LIKE '%> 资料未达到定时报发布门槛：%'
    OR "content" LIKE '%> 未配置模型或内容风格，已保留%'
  );

UPDATE "Post"
SET "status" = 'DRAFT', "publishedAt" = NULL
WHERE "publicationBlockedReason" IS NOT NULL;

ALTER TABLE "Post"
ADD CONSTRAINT "Post_blocked_generation_cannot_be_published"
CHECK ("publicationBlockedReason" IS NULL OR "status" <> 'PUBLISHED');
