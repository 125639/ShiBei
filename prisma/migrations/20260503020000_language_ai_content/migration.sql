-- Language, AI model routing, manual content, and ordering extensions.
-- Idempotent because production deployments may have partially-applied schema updates.

ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "newsLanguageMode" TEXT NOT NULL DEFAULT 'default-language',
  ADD COLUMN IF NOT EXISTS "defaultLanguage" TEXT NOT NULL DEFAULT 'zh',
  ADD COLUMN IF NOT EXISTS "newsModelConfigId" TEXT,
  ADD COLUMN IF NOT EXISTS "assistantModelConfigId" TEXT,
  ADD COLUMN IF NOT EXISTS "writingModelConfigId" TEXT,
  ADD COLUMN IF NOT EXISTS "translationModelConfigId" TEXT;

ALTER TABLE "ModelConfig"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'custom';

ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "titleEn" TEXT,
  ADD COLUMN IF NOT EXISTS "summaryEn" TEXT,
  ADD COLUMN IF NOT EXISTS "contentEn" TEXT,
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "translatedAt" TIMESTAMP(3);

ALTER TABLE "Video"
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Post_sortOrder_publishedAt_idx" ON "Post"("sortOrder", "publishedAt");
CREATE INDEX IF NOT EXISTS "Video_sortOrder_createdAt_idx" ON "Video"("sortOrder", "createdAt");
