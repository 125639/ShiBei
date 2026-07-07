-- Accelerate case-insensitive contains searches used by public/admin list pages.
-- PostgreSQL's pg_trgm extension supports ILIKE/contains patterns that btree
-- indexes cannot serve efficiently.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Post_title_trgm_idx" ON "Post" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Post_summary_trgm_idx" ON "Post" USING GIN ("summary" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Video_title_trgm_idx" ON "Video" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Video_summary_trgm_idx" ON "Video" USING GIN ("summary" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Video_sourcePlatform_trgm_idx" ON "Video" USING GIN ("sourcePlatform" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Tag_name_trgm_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ContentTopic_name_trgm_idx" ON "ContentTopic" USING GIN ("name" gin_trgm_ops);
