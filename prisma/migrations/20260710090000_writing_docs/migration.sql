-- 写作台文档(Notion 式写作页的持久化)

-- CreateTable
CREATE TABLE "WritingDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "anonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingDoc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WritingDoc_ownerId_updatedAt_idx" ON "WritingDoc"("ownerId", "updatedAt");
CREATE INDEX "WritingDoc_anonId_updatedAt_idx" ON "WritingDoc"("anonId", "updatedAt");

ALTER TABLE "WritingDoc" ADD CONSTRAINT "WritingDoc_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MemberUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
