-- Historical textbook creation migrations are no longer distributed, but the
-- subsequent OCR migration still alters TextbookPage. Preserve that migration's
-- checksum and allow fresh databases to reach remove_learning.
-- Existing installations retain their real table unchanged. Fresh installations
-- get only a temporary compatibility table, removed by 20261004160000.
CREATE TABLE IF NOT EXISTS "TextbookPage" (
  "id" TEXT NOT NULL PRIMARY KEY
);
