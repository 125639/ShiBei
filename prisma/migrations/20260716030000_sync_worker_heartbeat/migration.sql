-- Sync connectivity observability: the /admin/sync page needs to show whether
-- the frontend sync-worker process is alive and when the backend was last
-- reachable, so a "no connection" state stops looking like a random delay.
ALTER TABLE "SyncState"
  ADD COLUMN IF NOT EXISTS "workerAliveAt" TIMESTAMP(3);
ALTER TABLE "SyncState"
  ADD COLUMN IF NOT EXISTS "backendReachableAt" TIMESTAMP(3);
ALTER TABLE "SyncState"
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
