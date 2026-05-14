-- Frontend visual/media policy updates.
-- - Auto video discovery no longer downloads files by default.
-- - Auto image discovery can be controlled from admin settings.
-- - Videos can render as embedded media or as links without changing their source type.

ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "autoImageSearchEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SiteSettings"
  ALTER COLUMN "videoDownloadDomestic" SET DEFAULT false,
  ALTER COLUMN "videoMaxPerPost" SET DEFAULT 0,
  ALTER COLUMN "defaultFont" SET DEFAULT 'sans-cjk';

UPDATE "SiteSettings"
SET "videoDownloadDomestic" = false,
    "videoMaxPerPost" = 0,
    "defaultFont" = CASE WHEN "defaultFont" = 'serif-cjk' THEN 'sans-cjk' ELSE "defaultFont" END;

ALTER TABLE "Video"
  ADD COLUMN IF NOT EXISTS "displayMode" TEXT NOT NULL DEFAULT 'embed';
