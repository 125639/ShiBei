// Exercise the production bootstrap helper with bcrypt and a fake Prisma table.
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { seedAdminIfNeeded } from "../prisma/seed-helpers.mjs";

function fixture() {
  const rows = new Map();
  const table = {
    async findFirst() { return rows.values().next().value ?? null; },
    async upsert({ where, update, create }) {
      assert.deepEqual(update, {});
      if (!rows.has(where.username)) rows.set(where.username, { ...create, tokenVersion: 0 });
      return rows.get(where.username);
    }
  };
  return { rows, run: (env) => seedAdminIfNeeded(table, env, (pw) => bcrypt.hash(pw, 4)) };
}

test("first installation hashes the supplied password", async () => {
  const { run } = fixture();
  const row = await run({ ADMIN_PASSWORD: "first-password" });
  assert.equal(row.username, "admin");
  assert.equal(await bcrypt.compare("first-password", row.passwordHash), true);
  assert.equal(row.tokenVersion, 0);
});

test("restart never overwrites UI credentials, even if env is changed, missing, or default", async () => {
  const { run, rows } = fixture();
  const row = await run({ ADMIN_PASSWORD: "first-password" });
  row.passwordHash = await bcrypt.hash("changed-in-ui", 4);
  row.tokenVersion = 3;
  for (const env of [{}, { ADMIN_PASSWORD: "change-me-now" }, { ADMIN_PASSWORD: "different-env" }, { ADMIN_USERNAME: "other", ADMIN_PASSWORD: "different-env" }]) {
    const restarted = await run(env);
    assert.strictEqual(restarted, row);
    assert.equal(await bcrypt.compare("changed-in-ui", restarted.passwordHash), true);
    assert.equal(restarted.tokenVersion, 3);
    assert.equal(rows.size, 1);
  }
});

test("first installation rejects missing, short and public default credentials", async () => {
  for (const password of [undefined, "", "short", "        ", "change-me-now"]) {
    const { run, rows } = fixture();
    await assert.rejects(run({ ADMIN_PASSWORD: password }), /ADMIN_PASSWORD/);
    assert.equal(rows.size, 0);
  }
});

test("concurrent bootstrap does not rotate an already inserted hash", async () => {
  const { run, rows } = fixture();
  const [a, b] = await Promise.all([run({ ADMIN_PASSWORD: "password-one" }), run({ ADMIN_PASSWORD: "password-two" })]);
  assert.strictEqual(a, b);
  assert.equal(rows.size, 1);
});
