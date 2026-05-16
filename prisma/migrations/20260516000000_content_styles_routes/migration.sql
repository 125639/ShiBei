-- Rename the news/summary content-production schema to neutral content terms.
-- The migration preserves rows and relation tables instead of recreating them.

ALTER TABLE "SiteSettings" RENAME COLUMN "newsDisplayMode" TO "contentDisplayMode";
ALTER TABLE "SiteSettings" RENAME COLUMN "newsLanguageMode" TO "contentLanguageMode";
ALTER TABLE "SiteSettings" RENAME COLUMN "newsModelConfigId" TO "contentModelConfigId";

ALTER TABLE "FetchJob" DROP CONSTRAINT IF EXISTS "FetchJob_newsTopicId_fkey";
ALTER TABLE "NewsTopic" DROP CONSTRAINT IF EXISTS "NewsTopic_styleId_fkey";
ALTER TABLE "AutoSchedule" DROP CONSTRAINT IF EXISTS "AutoSchedule_topicId_fkey";
ALTER TABLE "_PostTopics" DROP CONSTRAINT IF EXISTS "_PostTopics_A_fkey";
ALTER TABLE "_PostTopics" DROP CONSTRAINT IF EXISTS "_PostTopics_B_fkey";
ALTER TABLE "_TopicToModule" DROP CONSTRAINT IF EXISTS "_TopicToModule_A_fkey";
ALTER TABLE "_TopicToModule" DROP CONSTRAINT IF EXISTS "_TopicToModule_B_fkey";

ALTER TABLE "FetchJob" RENAME COLUMN "summaryStyleId" TO "contentStyleId";
ALTER TABLE "FetchJob" RENAME COLUMN "newsTopicId" TO "contentTopicId";

ALTER TABLE "SummaryStyle" RENAME TO "ContentStyle";
ALTER TABLE "NewsTopic" RENAME TO "ContentTopic";
ALTER TABLE "_PostTopics" RENAME TO "_PostContentTopics";
ALTER TABLE "_TopicToModule" RENAME TO "_ContentTopicToModule";

ALTER INDEX IF EXISTS "NewsTopic_name_key" RENAME TO "ContentTopic_name_key";
ALTER INDEX IF EXISTS "NewsTopic_slug_key" RENAME TO "ContentTopic_slug_key";
ALTER INDEX IF EXISTS "_PostTopics_AB_unique" RENAME TO "_PostContentTopics_AB_unique";
ALTER INDEX IF EXISTS "_PostTopics_B_index" RENAME TO "_PostContentTopics_B_index";
ALTER INDEX IF EXISTS "_TopicToModule_B_index" RENAME TO "_ContentTopicToModule_B_index";

ALTER TABLE "ContentStyle" RENAME CONSTRAINT "SummaryStyle_pkey" TO "ContentStyle_pkey";
ALTER TABLE "ContentTopic" RENAME CONSTRAINT "NewsTopic_pkey" TO "ContentTopic_pkey";

ALTER TABLE "ContentStyle" RENAME COLUMN "promptTemplate" TO "customInstructions";
ALTER TABLE "ContentStyle" ADD COLUMN "contentMode" TEXT NOT NULL DEFAULT 'report';

ALTER TABLE "ContentStyle"
  ALTER COLUMN "tone" SET DEFAULT '客观',
  ALTER COLUMN "focus" SET DEFAULT '事实, 背景, 影响',
  ALTER COLUMN "outputStructure" SET DEFAULT '标题, 导语, 正文分章节叙述, 参考来源';

ALTER TABLE "FetchJob"
  ADD CONSTRAINT "FetchJob_contentTopicId_fkey"
  FOREIGN KEY ("contentTopicId") REFERENCES "ContentTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentTopic"
  ADD CONSTRAINT "ContentTopic_styleId_fkey"
  FOREIGN KEY ("styleId") REFERENCES "ContentStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutoSchedule"
  ADD CONSTRAINT "AutoSchedule_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "ContentTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_PostContentTopics"
  ADD CONSTRAINT "_PostContentTopics_A_fkey"
  FOREIGN KEY ("A") REFERENCES "ContentTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_PostContentTopics"
  ADD CONSTRAINT "_PostContentTopics_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContentTopicToModule"
  ADD CONSTRAINT "_ContentTopicToModule_A_fkey"
  FOREIGN KEY ("A") REFERENCES "ContentTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContentTopicToModule"
  ADD CONSTRAINT "_ContentTopicToModule_B_fkey"
  FOREIGN KEY ("B") REFERENCES "SourceModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
