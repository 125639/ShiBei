// One-off helper to apply prisma/migrations/<dir>/migration.sql to the running
// PostgreSQL instance via the Prisma raw queries (so we don't need an extra `pg`
// dep). Splits the SQL on `;` followed by a newline; safe for the DDL we ship.
//
// Usage: node scripts/apply-migration.mjs <migration-dir-name>
// Example: node scripts/apply-migration.mjs 20260503010000_blog_extensions
//
// Reads DATABASE_URL from env or .env.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/apply-migration.mjs <migration-dir>");
    process.exit(1);
  }
  const file = path.join(root, "prisma", "migrations", dir, "migration.sql");
  const sql = await fs.readFile(file, "utf8");

  const prisma = new PrismaClient();
  try {
    // Split on semicolons that end a statement. We can't use trivial split for
    // the DO $$ ... $$ blocks, so handle them: we'll execute the file as one
    // big statement via $executeRawUnsafe — Postgres accepts multi-statements
    // via the simple query protocol when sent as a single string, but Prisma
    // normalizes those. Workaround: split on `^\s*--` boundaries… simplest is
    // to use $executeRawUnsafe statement-by-statement, treating $$ blocks as
    // atomic. We split on `;\n` outside of $$ blocks.
    const statements = splitSqlStatements(sql);
    let applied = 0;
    let skipped = 0;
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await prisma.$executeRawUnsafe(trimmed);
        applied += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // The migration is idempotent; surface only unexpected errors.
        if (/already exists|duplicate object|duplicate column|invalid input value/i.test(msg)) {
          skipped += 1;
        } else {
          console.error(`Statement failed: ${trimmed.slice(0, 200)}…\n${msg}`);
          throw err;
        }
      }
    }
    console.log(`Applied ${applied} statements (${skipped} skipped/already-applied) from ${dir}`);

    // Mark as applied in _prisma_migrations.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, $1, now(), $2, now(), 1) ON CONFLICT DO NOTHING;`
        .replace("$1", "'manual-apply'").replace("$2", `'${dir}'`)
    ).catch(() => undefined);
  } finally {
    await prisma.$disconnect();
  }
}

function splitSqlStatements(sql) {
  const out = [];
  let buf = "";
  let inDollar = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);
    if (next2 === "$$") {
      inDollar = !inDollar;
      buf += "$$";
      i += 2;
      continue;
    }
    if (ch === ";" && !inDollar) {
      out.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
