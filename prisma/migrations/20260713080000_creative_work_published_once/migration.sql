-- Anonymous creators explicitly accept that publication is irreversible. The
-- current publishedAt column describes present visibility and is cleared by an
-- administrator UNPUBLISH, so it cannot enforce that promise by itself.
ALTER TABLE "CreativeWork"
ADD COLUMN "publishedOnceAt" TIMESTAMP(3);

-- Upgrade compatibility:
--   * currently public rows have status/publishedAt;
--   * previously unpublished rows retain a moderation surface and audit log.
-- Prefer the earliest surviving moderation timestamp, then the current publish
-- timestamp, with updatedAt as a conservative fallback for malformed legacy
-- SHARED rows that never received publishedAt.
UPDATE "CreativeWork" AS work
SET "publishedOnceAt" = COALESCE(
  (
    SELECT MIN(log."createdAt")
    FROM "CommunityModerationLog" AS log
    WHERE log."targetWorkId" = work."id"
  ),
  (
    SELECT MIN(surface."createdAt")
    FROM "CommunityModeratedSurface" AS surface
    WHERE surface."workId" = work."id"
  ),
  work."publishedAt",
  work."updatedAt"
)
WHERE
  work."status" = 'SHARED'
  OR work."publishedAt" IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM "CommunityModerationLog" AS log
    WHERE log."targetWorkId" = work."id"
  )
  OR EXISTS (
    SELECT 1
    FROM "CommunityModeratedSurface" AS surface
    WHERE surface."workId" = work."id"
  );

-- Database-level monotonicity: once set, the timestamp cannot be cleared or
-- rewritten. It is also populated for any SHARED insert/update, covering seed,
-- repair and future code paths that do not go through the public publish route.
CREATE FUNCTION "CreativeWork_preserve_published_once_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."publishedOnceAt" IS NOT NULL THEN
    NEW."publishedOnceAt" := OLD."publishedOnceAt";
  ELSIF NEW."status" = 'SHARED' AND NEW."publishedOnceAt" IS NULL THEN
    NEW."publishedOnceAt" := COALESCE(NEW."publishedAt", CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CreativeWork_preserve_published_once_at_trigger"
BEFORE INSERT OR UPDATE ON "CreativeWork"
FOR EACH ROW
EXECUTE FUNCTION "CreativeWork_preserve_published_once_at"();
