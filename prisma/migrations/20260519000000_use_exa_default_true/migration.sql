-- Wire up the per-topic ContentTopic.useExa flag.
-- Previously the column existed but no code read it; the schema default was
-- `false`, so backfilling to `true` matches the historical effective behaviour
-- (Exa was always used when site-level enabled). Idempotent: safe to re-run.

ALTER TABLE "ContentTopic" ALTER COLUMN "useExa" SET DEFAULT true;
UPDATE "ContentTopic" SET "useExa" = true WHERE "useExa" = false;
