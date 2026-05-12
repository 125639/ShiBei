-- Add per-platform international video download allowlist + per-post cap.
-- Idempotent: re-runnable on partially-applied DBs.

ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "videoDownloadHosts" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "videoMaxPerPost" INTEGER NOT NULL DEFAULT 4;
