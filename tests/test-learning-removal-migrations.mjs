import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../prisma/migrations/', import.meta.url);
const bridge = '20261004125900_removed_textbook_compatibility';
const ocr = '20261004130000_recognition_model_role';
const remove = '20261004160000_remove_learning';
const cleanup = '20261004170000_removed_textbook_final_cleanup';
const sql = name => readFileSync(new URL(`${name}/migration.sql`, root), 'utf8');

test('compatibility runs before legacy OCR and final cleanup runs after removal', () => {
  const names = readdirSync(root).sort();
  for (const name of [bridge, ocr, remove, cleanup]) assert.ok(names.includes(name));
  assert.ok(names.indexOf(bridge) < names.indexOf(ocr));
  assert.ok(names.indexOf(remove) < names.indexOf(cleanup));
  assert.match(sql(bridge), /CREATE TABLE IF NOT EXISTS "TextbookPage"/);
  assert.match(sql(cleanup), /DROP TABLE IF EXISTS "TextbookPage"/);
});

// Opt-in real SQL tests: never read DATABASE_URL or the application's .env.
// Each scenario lives in a transaction-local schema and is rolled back.
const url = process.env.MIGRATION_TEST_DATABASE_URL;
for (const scenario of ['fresh', 'existing-textbook', 'ocr-already-applied', 'removal-already-applied']) {
  test(`PostgreSQL removal upgrade: ${scenario}`, { skip: !url }, () => {
    const target = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.equal(target.pathname, '/removal_audit');
    const schema = `removal_test_${process.pid}_${scenario.replaceAll('-', '_')}`;
    const existing = scenario !== 'fresh' && scenario !== 'removal-already-applied';
    const setup = `
      CREATE TABLE "SiteSettings" (id TEXT PRIMARY KEY, "teachingModelConfigId" TEXT);
      CREATE TABLE "ModelConfig" (id TEXT PRIMARY KEY, provider TEXT, model TEXT, "isDefault" BOOLEAN);
      CREATE TYPE "LearningCheckKind" AS ENUM ('MCQ', 'NUMERIC');
      ${existing ? `CREATE TABLE "TextbookPage" (id TEXT PRIMARY KEY, text TEXT);
      INSERT INTO "TextbookPage" VALUES ('preserved', 'original');` : ''}
    `;
    const preserve = existing ? `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM "TextbookPage" WHERE text = 'original') THEN
        RAISE EXCEPTION 'bridge destroyed existing data';
      END IF;
    END $$;` : '';
    const upgrade = scenario === 'removal-already-applied'
      ? sql(remove) + sql(bridge) + sql(cleanup)
      : scenario === 'ocr-already-applied'
        ? sql(ocr) + sql(bridge) + preserve + sql(remove) + sql(cleanup)
        : sql(bridge) + preserve + sql(ocr) + sql(remove) + sql(cleanup);
    const result = spawnSync('psql', ['-X', url, '-v', 'ON_ERROR_STOP=1'], {
      encoding: 'utf8', input: `BEGIN; CREATE SCHEMA "${schema}";
      SET LOCAL search_path TO "${schema}";
      ${setup} ${upgrade}
      DO $$ BEGIN
        IF to_regclass('"TextbookPage"') IS NOT NULL THEN RAISE EXCEPTION 'table remains'; END IF;
        IF to_regtype('"LearningCheckKind"') IS NOT NULL THEN RAISE EXCEPTION 'enum remains'; END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND column_name IN ('teachingModelConfigId', 'recognitionModelConfigId')) THEN
          RAISE EXCEPTION 'routing columns remain';
        END IF;
      END $$;
      ROLLBACK;`
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}
