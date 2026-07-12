-- New content models need enough headroom for a complete long-form article.
-- Existing rows are intentionally untouched: an administrator may have chosen
-- a lower cap. Content-generation calls apply their own task-specific floor.
ALTER TABLE "ModelConfig" ALTER COLUMN "maxTokens" SET DEFAULT 8000;
