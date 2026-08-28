-- Migration: SyncState single-row table for frontend/backend sync bookkeeping.
-- Idempotent: IF NOT EXISTS guard so re-running on a partially-applied DB is safe.

CREATE TABLE IF NOT EXISTS "SyncState" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "lastImportedAt"        TIMESTAMP(3),
  "lastImportedPostCount" INTEGER NOT NULL DEFAULT 0,
  "lastExportedAt"        TIMESTAMP(3),
  "lastError"             TEXT,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed the singleton row (id="sync") if not present.
INSERT INTO "SyncState" ("id", "updatedAt")
VALUES ('sync', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
