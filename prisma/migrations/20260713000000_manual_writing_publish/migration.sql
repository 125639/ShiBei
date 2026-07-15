-- 纯手写文档完成后可以一次性交接到社区评分/发布流程。
-- WritingDoc.creativeWorkId 是唯一绑定：同一文档不能生成多个作品。

ALTER TYPE "CreationMode" ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TABLE "WritingDoc"
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "creativeWorkId" TEXT;

CREATE UNIQUE INDEX "WritingDoc_creativeWorkId_key" ON "WritingDoc"("creativeWorkId");

ALTER TABLE "WritingDoc"
ADD CONSTRAINT "WritingDoc_creativeWorkId_fkey"
FOREIGN KEY ("creativeWorkId") REFERENCES "CreativeWork"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
