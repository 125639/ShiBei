-- Let administrators temporarily remove an unhealthy provider from runtime
-- routing without deleting its encrypted credentials or historical identity.
ALTER TABLE "ModelConfig"
  ADD COLUMN IF NOT EXISTS "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS "ModelConfig_isEnabled_isDefault_idx"
  ON "ModelConfig"("isEnabled", "isDefault");
