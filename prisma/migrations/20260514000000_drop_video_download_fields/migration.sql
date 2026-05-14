-- Drop unused video download fields (auto-download is fully removed).
-- Switch default theme to 'apple' for new installs.
-- Add Video.lastPlacement so the admin can remember per-video preset position.

ALTER TABLE "SiteSettings"
  DROP COLUMN IF EXISTS "videoDownloadDomestic",
  DROP COLUMN IF EXISTS "videoDownloadHosts",
  DROP COLUMN IF EXISTS "videoMaxPerPost",
  DROP COLUMN IF EXISTS "videoMaxDurationSec";

ALTER TABLE "SiteSettings"
  ALTER COLUMN "defaultTheme" SET DEFAULT 'apple';

UPDATE "SiteSettings"
SET "defaultTheme" = 'apple'
WHERE "defaultTheme" = 'minimal';

ALTER TABLE "Video"
  ADD COLUMN IF NOT EXISTS "lastPlacement" VARCHAR(32);
