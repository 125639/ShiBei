-- Keep the newest explicitly-default model when historical application races
-- or manual database edits left more than one. ID is the deterministic final
-- tie-breaker for equal timestamps.
WITH ranked_defaults AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" ASC
    ) AS position
  FROM "ModelConfig"
  WHERE "isDefault" = TRUE
)
UPDATE "ModelConfig" AS config
SET "isDefault" = FALSE
FROM ranked_defaults AS ranked
WHERE config."id" = ranked."id"
  AND ranked.position > 1;

-- Older installations can also contain models without any default. Promote
-- the same deterministic winner used by runtime fallback selection.
UPDATE "ModelConfig"
SET "isDefault" = TRUE
WHERE "id" = (
  SELECT "id"
  FROM "ModelConfig"
  ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "ModelConfig" WHERE "isDefault" = TRUE
);

CREATE UNIQUE INDEX "ModelConfig_single_default_key"
ON "ModelConfig" ("isDefault")
WHERE "isDefault" = TRUE;

-- The old stream checkbox was persisted but runtime completions have always
-- used complete JSON responses. Retain the column for rollback compatibility
-- while normalizing its now-deprecated value.
UPDATE "ModelConfig" SET "stream" = FALSE WHERE "stream" = TRUE;
