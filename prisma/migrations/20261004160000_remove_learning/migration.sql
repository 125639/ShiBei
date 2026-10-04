-- 移除学习/教材功能：删除伴学与教材表、OCR/教学模型路由列及 OCR 约束。

DROP TABLE IF EXISTS "LearningCheck";
DROP TABLE IF EXISTS "LearningNode";
DROP TABLE IF EXISTS "TextbookPage";
DROP TABLE IF EXISTS "TextbookDocument";

ALTER TABLE "SiteSettings" DROP COLUMN IF EXISTS "teachingModelConfigId";
ALTER TABLE "SiteSettings" DROP COLUMN IF EXISTS "recognitionModelConfigId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ModelConfig_ocr_not_default_check') THEN
    ALTER TABLE "ModelConfig" DROP CONSTRAINT "ModelConfig_ocr_not_default_check";
  END IF;
END $$;
