-- Migration: blog extensions for theme/storage/music/modules/exa/video downloads
-- Idempotent: uses IF NOT EXISTS guards so re-running on a partially-applied DB still works.

-- 1. Source modules (taxonomy)
CREATE TABLE IF NOT EXISTS "SourceModule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "color" TEXT NOT NULL DEFAULT '#9f4f2f',
  "iconKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Source <-> Module (many-to-many, named "SourceToModule")
CREATE TABLE IF NOT EXISTS "_SourceToModule" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_SourceToModule_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX IF NOT EXISTS "_SourceToModule_B_index" ON "_SourceToModule" ("B");

DO $$ BEGIN
  ALTER TABLE "_SourceToModule"
    ADD CONSTRAINT "_SourceToModule_A_fkey" FOREIGN KEY ("A") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "_SourceToModule"
    ADD CONSTRAINT "_SourceToModule_B_fkey" FOREIGN KEY ("B") REFERENCES "SourceModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Topic <-> Module (many-to-many, named "TopicToModule")
CREATE TABLE IF NOT EXISTS "_TopicToModule" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_TopicToModule_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX IF NOT EXISTS "_TopicToModule_B_index" ON "_TopicToModule" ("B");

DO $$ BEGIN
  ALTER TABLE "_TopicToModule"
    ADD CONSTRAINT "_TopicToModule_A_fkey" FOREIGN KEY ("A") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "_TopicToModule"
    ADD CONSTRAINT "_TopicToModule_B_fkey" FOREIGN KEY ("B") REFERENCES "SourceModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. SourceType: add EXA enum value
DO $$ BEGIN
  ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'EXA';
EXCEPTION WHEN others THEN NULL; END $$;

-- 3. SourceRegion enum (new)
DO $$ BEGIN
  CREATE TYPE "SourceRegion" AS ENUM ('DOMESTIC','INTERNATIONAL','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Source"
  ADD COLUMN IF NOT EXISTS "region" "SourceRegion" NOT NULL DEFAULT 'UNKNOWN';

-- 4. NewsTopic: useExa flag
ALTER TABLE "NewsTopic"
  ADD COLUMN IF NOT EXISTS "useExa" BOOLEAN NOT NULL DEFAULT false;

-- 5. SiteSettings: lots of new admin-controlled fields
ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "defaultTheme" TEXT NOT NULL DEFAULT 'minimal',
  ADD COLUMN IF NOT EXISTS "defaultFont" TEXT NOT NULL DEFAULT 'serif-cjk',
  ADD COLUMN IF NOT EXISTS "textOnlyMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "maxStorageMb" INTEGER NOT NULL DEFAULT 2048,
  ADD COLUMN IF NOT EXISTS "cleanupAfterDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "cleanupCustomEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "videoMaxDurationSec" INTEGER NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS "videoDownloadDomestic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "exaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exaApiKeyEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "musicEnabledDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "defaultMusicId" TEXT,
  ADD COLUMN IF NOT EXISTS "globalPromptPrefix" TEXT NOT NULL DEFAULT '';

-- 6. Video: enrichment columns + region
ALTER TABLE "Video"
  ADD COLUMN IF NOT EXISTS "durationSec" INTEGER,
  ADD COLUMN IF NOT EXISTS "region" "SourceRegion" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT,
  ADD COLUMN IF NOT EXISTS "sourcePageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "localPath" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSizeBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "attribution" TEXT;

-- 7. Music
CREATE TABLE IF NOT EXISTS "Music" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "artist" TEXT,
  "filePath" TEXT NOT NULL,
  "fileSizeBytes" INTEGER,
  "durationSec" INTEGER,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
