-- Add indexes for the recurring public/admin list views, stats dashboard,
-- scheduler lookups, and cleanup jobs.
--
-- All statements use IF NOT EXISTS: "Video_sortOrder_createdAt_idx" was
-- already created (guarded) by 20260503020000_language_ai_content, so an
-- unguarded CREATE INDEX here always fails with 42P07 on any deploy that
-- runs the full migration history in order, from a fresh database or an
-- upgrade alike.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ModelConfig_isDefault_idx" ON "ModelConfig"("isDefault");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Source_status_isDefault_idx" ON "Source"("status", "isDefault");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FetchJob_status_updatedAt_idx" ON "FetchJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FetchJob_createdAt_idx" ON "FetchJob"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FetchJob_completedAt_idx" ON "FetchJob"("completedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FetchJob_sourceId_idx" ON "FetchJob"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FetchJob_contentTopicId_idx" ON "FetchJob"("contentTopicId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RawItem_createdAt_idx" ON "RawItem"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RawItem_sourceId_idx" ON "RawItem"("sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RawItem_fetchJobId_idx" ON "RawItem"("fetchJobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_status_sortOrder_publishedAt_idx" ON "Post"("status", "sortOrder", "publishedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_status_publishedAt_idx" ON "Post"("status", "publishedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_status_createdAt_idx" ON "Post"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_updatedAt_idx" ON "Post"("updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Video_sortOrder_createdAt_idx" ON "Video"("sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Video_createdAt_idx" ON "Video"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Video_postId_sortOrder_idx" ON "Video"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Music_isEnabled_sortOrder_idx" ON "Music"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentTopic_isEnabled_createdAt_idx" ON "ContentTopic"("isEnabled", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentTopic_styleId_idx" ON "ContentTopic"("styleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AutoSchedule_isEnabled_nextRunAt_idx" ON "AutoSchedule"("isEnabled", "nextRunAt");
