-- CreateEnum
CREATE TYPE "CompilationKind" AS ENUM ('SINGLE_ARTICLE', 'DAILY_DIGEST', 'WEEKLY_ROUNDUP');

-- AlterTable: SiteSettings — add auto curation toggle + display mode
ALTER TABLE "SiteSettings" ADD COLUMN "autoCurationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN "newsDisplayMode" TEXT NOT NULL DEFAULT 'grid';

-- AlterTable: Post — add compilation kind
ALTER TABLE "Post" ADD COLUMN "kind" "CompilationKind" NOT NULL DEFAULT 'SINGLE_ARTICLE';

-- AlterTable: FetchJob — link job to a NewsTopic when run via auto-curation
ALTER TABLE "FetchJob" ADD COLUMN "newsTopicId" TEXT;

-- CreateTable: NewsTopic
CREATE TABLE "NewsTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "keywords" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "compileKind" "CompilationKind" NOT NULL DEFAULT 'SINGLE_ARTICLE',
    "depth" TEXT NOT NULL DEFAULT 'long',
    "articleCount" INTEGER NOT NULL DEFAULT 1,
    "styleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AutoSchedule
CREATE TABLE "AutoSchedule" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "bullJobKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: implicit Post <-> NewsTopic relation
CREATE TABLE "_PostTopics" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsTopic_name_key" ON "NewsTopic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NewsTopic_slug_key" ON "NewsTopic"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AutoSchedule_topicId_key" ON "AutoSchedule"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoSchedule_bullJobKey_key" ON "AutoSchedule"("bullJobKey");

-- CreateIndex
CREATE UNIQUE INDEX "_PostTopics_AB_unique" ON "_PostTopics"("A", "B");

-- CreateIndex
CREATE INDEX "_PostTopics_B_index" ON "_PostTopics"("B");

-- AddForeignKey
ALTER TABLE "FetchJob" ADD CONSTRAINT "FetchJob_newsTopicId_fkey" FOREIGN KEY ("newsTopicId") REFERENCES "NewsTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsTopic" ADD CONSTRAINT "NewsTopic_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "SummaryStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoSchedule" ADD CONSTRAINT "AutoSchedule_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostTopics" ADD CONSTRAINT "_PostTopics_A_fkey" FOREIGN KEY ("A") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostTopics" ADD CONSTRAINT "_PostTopics_B_fkey" FOREIGN KEY ("B") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
