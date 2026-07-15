-- Preserve private handwritten source documents after deleting their public copies,
-- while locking those exact documents out of another one-click community handoff.
ALTER TABLE "WritingDoc"
ADD COLUMN "publicationBlockedAt" TIMESTAMP(3);

-- Remember the exact version removed by community moderation. The hash is retained
-- across later edits so restoring the moderated text cannot bypass the block.
-- Scores also retain the normalized rubric snapshot they were produced against.
ALTER TABLE "CreativeWork"
ADD COLUMN "moderationBlockedHash" TEXT,
ADD COLUMN "moderationReason" TEXT,
ADD COLUMN "scoredRubricHash" TEXT;
