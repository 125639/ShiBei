-- 教材伴学 · 教学讲解模型角色（docs/interactive-math-learning-plan.md §8.1）。
ALTER TABLE "SiteSettings" ADD COLUMN "teachingModelConfigId" TEXT;

ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_teachingModelConfigId_fkey"
  FOREIGN KEY ("teachingModelConfigId") REFERENCES "ModelConfig"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
