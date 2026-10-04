-- If remove_learning ran before the compatibility bridge was shipped, Prisma
-- can apply the pending bridge later. Always remove its placeholder afterwards.
DROP TABLE IF EXISTS "TextbookPage";
DROP TYPE IF EXISTS "LearningCheckKind";
