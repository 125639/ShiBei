-- Add indexes for the recurring public/admin list views, stats dashboard,
-- scheduler lookups, and cleanup jobs.

-- CreateIndex
CREATE INDEX "ModelConfig_isDefault_idx" ON "ModelConfig"("isDefault");

-- CreateIndex
CREATE INDEX "Source_status_isDefault_idx" ON "Source"("status", "isDefault");

-- CreateIndex
CREATE INDEX "FetchJob_status_updatedAt_idx" ON "FetchJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "FetchJob_createdAt_idx" ON "FetchJob"("createdAt");

-- CreateIndex
CREATE INDEX "FetchJob_completedAt_idx" ON "FetchJob"("completedAt");

-- CreateIndex
CREATE INDEX "FetchJob_sourceId_idx" ON "FetchJob"("sourceId");

-- CreateIndex
CREATE INDEX "FetchJob_contentTopicId_idx" ON "FetchJob"("contentTopicId");

-- CreateIndex
CREATE INDEX "RawItem_createdAt_idx" ON "RawItem"("createdAt");

-- CreateIndex
CREATE INDEX "RawItem_sourceId_idx" ON "RawItem"("sourceId");

-- CreateIndex
CREATE INDEX "RawItem_fetchJobId_idx" ON "RawItem"("fetchJobId");

-- CreateIndex
CREATE INDEX "Post_status_sortOrder_publishedAt_idx" ON "Post"("status", "sortOrder", "publishedAt");

-- CreateIndex
CREATE INDEX "Post_status_publishedAt_idx" ON "Post"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Post_status_createdAt_idx" ON "Post"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Post_updatedAt_idx" ON "Post"("updatedAt");

-- CreateIndex
CREATE INDEX "Video_sortOrder_createdAt_idx" ON "Video"("sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");

-- CreateIndex
CREATE INDEX "Video_postId_sortOrder_idx" ON "Video"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX "Music_isEnabled_sortOrder_idx" ON "Music"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "ContentTopic_isEnabled_createdAt_idx" ON "ContentTopic"("isEnabled", "createdAt");

-- CreateIndex
CREATE INDEX "ContentTopic_styleId_idx" ON "ContentTopic"("styleId");

-- CreateIndex
CREATE INDEX "AutoSchedule_isEnabled_nextRunAt_idx" ON "AutoSchedule"("isEnabled", "nextRunAt");
