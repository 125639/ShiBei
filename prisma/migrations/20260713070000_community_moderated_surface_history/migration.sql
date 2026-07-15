-- A single "latest" moderation hash can be overwritten by a later unpublish,
-- allowing the owner to restore an earlier moderated version. Keep every distinct
-- public surface for the lifetime of the work instead. New records bind
-- title+summary+body; legacy records retain their title+body matching algorithm.
CREATE TYPE "CommunitySurfaceAlgorithm" AS ENUM (
  'TITLE_CONTENT_V1',
  'TITLE_SUMMARY_CONTENT_V2'
);

CREATE TABLE "CommunityModeratedSurface" (
  "id" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "algorithm" "CommunitySurfaceAlgorithm" NOT NULL DEFAULT 'TITLE_SUMMARY_CONTENT_V2',
  "surfaceHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommunityModeratedSurface_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityModeratedSurface_workId_fkey"
    FOREIGN KEY ("workId") REFERENCES "CreativeWork"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommunityModeratedSurface_workId_algorithm_surfaceHash_key"
ON "CommunityModeratedSurface"("workId", "algorithm", "surfaceHash");

CREATE INDEX "CommunityModeratedSurface_workId_createdAt_idx"
ON "CommunityModeratedSurface"("workId", "createdAt");

-- Preserve every latest-hash record written between migrations 50000 and 70000.
-- Historical timestamps were not stored separately, so updatedAt is the closest
-- available ordering signal. The immutable audit log remains the authoritative log.
INSERT INTO "CommunityModeratedSurface" (
  "id", "workId", "algorithm", "surfaceHash", "reason", "createdAt"
)
SELECT
  'legacy_' || "id",
  "id",
  'TITLE_CONTENT_V1'::"CommunitySurfaceAlgorithm",
  "moderationBlockedHash",
  COALESCE(NULLIF("moderationReason", ''), '历史治理版本'),
  "updatedAt"
FROM "CreativeWork"
WHERE "moderationBlockedHash" IS NOT NULL
ON CONFLICT ("workId", "algorithm", "surfaceHash") DO NOTHING;

-- New audit rows preserve the complete public card snapshot. Existing logs predate
-- summary-bound governance and intentionally remain NULL rather than inventing text.
ALTER TABLE "CommunityModerationLog"
ADD COLUMN "summarySnapshot" TEXT;

-- The history table is now the sole enforcement source. Removing the superseded
-- columns prevents future code from accidentally checking only the latest surface.
ALTER TABLE "CreativeWork"
DROP COLUMN "moderationBlockedHash",
DROP COLUMN "moderationReason";
