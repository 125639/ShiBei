-- OCR has an explicit assignment, separate from textbook teaching/chat.
ALTER TABLE "SiteSettings" ADD COLUMN "recognitionModelConfigId" TEXT;

ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_recognitionModelConfigId_fkey"
  FOREIGN KEY ("recognitionModelConfigId") REFERENCES "ModelConfig"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Persist OCR attribution and printed page numbers independently of PDF order.
ALTER TABLE "TextbookPage" ADD COLUMN "printedPageNumber" INTEGER;
ALTER TABLE "TextbookPage" ADD COLUMN "recognitionModel" TEXT;

-- Repair legacy OCR defaults before enforcing the OCR-only boundary.
UPDATE "ModelConfig" SET "isDefault" = FALSE
  WHERE "provider" = 'mistral-ocr' OR "model" LIKE 'mistral-ocr%';
ALTER TABLE "ModelConfig" ADD CONSTRAINT "ModelConfig_ocr_not_default_check"
  CHECK (NOT ("provider" = 'mistral-ocr' OR "model" LIKE 'mistral-ocr%') OR NOT "isDefault");
