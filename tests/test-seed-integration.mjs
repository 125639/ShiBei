// 集成测试：模拟 seed.ts 的实际工作流（两次 db:seed 跑），验证
// `update.passwordHash` 真的让 .env 里改的 ADMIN_PASSWORD 在第二次 seed 时
// 同步到数据库。这是用户报告的 /admin/login?error=1 那个 bug 的回归测试。
//
// 跑法（需要 bcryptjs，运行前 `npm install bcryptjs` 在本目录）：
//   node --test tests/test-seed-integration.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { buildAdminUpsertArgs } from "../prisma/seed-helpers.mjs";

// 内存里的"数据库"：键是 username，值是 { username, passwordHash }
class FakeAdminUserTable {
  constructor() {
    this.rows = new Map();
    this.callLog = [];
  }
  async upsert({ where, update, create }) {
    this.callLog.push({ where: { ...where }, update: { ...update }, create: { ...create } });
    const existing = this.rows.get(where.username);
    if (existing) {
      // prisma upsert update 语义：只覆盖 update 里出现的字段
      const merged = { ...existing, ...update };
      this.rows.set(where.username, merged);
      return merged;
    }
    this.rows.set(create.username, { ...create });
    return { ...create };
  }
  findUnique({ where }) {
    return this.rows.get(where.username) ?? null;
  }
}

// 模拟 seed.ts 那一段 admin upsert 的关键逻辑：
//   const passwordHash = await bcrypt.hash(password, 12);
//   await prisma.adminUser.upsert(buildAdminUpsertArgs(env, passwordHash));
async function runSeedAdminStep(table, env) {
  const password = env.ADMIN_PASSWORD || "change-me-now";
  const passwordHash = await bcrypt.hash(password, 12);
  await table.upsert(buildAdminUpsertArgs(env, passwordHash));
}

describe("seed admin upsert — full integration with bcrypt + fake prisma", () => {
  test("first seed creates admin with .env password (bcrypt.compare succeeds)", async () => {
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "first-pw" });

    const row = table.findUnique({ where: { username: "admin" } });
    assert.ok(row, "admin user must exist after seed");
    assert.equal(await bcrypt.compare("first-pw", row.passwordHash), true);
    assert.equal(await bcrypt.compare("wrong-pw", row.passwordHash), false);
  });

  test("BUG REGRESSION: second seed with new ADMIN_PASSWORD must overwrite old hash", async () => {
    // 这个用例直接复现 user 报告的场景：
    //   1) 第一次 wizard 跑，stdin EOF → 走默认密码 ihMZLmJ9YFmjIXzB → 数据库存这个 hash
    //   2) 用户重跑 wizard，写入 .env 新密码 x40YrL7qeqZYSa6V
    //   3) docker compose up -d → start-app.sh 跑 npm run db:seed 第二次
    //   4) 修复前: update: {} → 数据库密码不变 → 用 .env 里的新密码登录失败
    //   5) 修复后: update: { passwordHash } → 数据库密码同步成新的 → 登录成功
    const table = new FakeAdminUserTable();
    const oldPw = "ihMZLmJ9YFmjIXzB";
    const newPw = "x40YrL7qeqZYSa6V";

    await runSeedAdminStep(table, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: oldPw });
    const afterFirst = table.findUnique({ where: { username: "admin" } });
    assert.equal(await bcrypt.compare(oldPw, afterFirst.passwordHash), true,
      "sanity: first seed must accept the first password");

    await runSeedAdminStep(table, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: newPw });
    const afterSecond = table.findUnique({ where: { username: "admin" } });

    assert.equal(await bcrypt.compare(newPw, afterSecond.passwordHash), true,
      "after second seed, the new .env password MUST work — this is the bug fix");
    assert.equal(await bcrypt.compare(oldPw, afterSecond.passwordHash), false,
      "after second seed, the old password MUST be invalidated");
    assert.notEqual(afterFirst.passwordHash, afterSecond.passwordHash,
      "the bcrypt hash itself must rotate — proves update branch executed");
  });

  test("upsert call log: first run hits create branch, second hits update branch", async () => {
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_PASSWORD: "a" });
    await runSeedAdminStep(table, { ADMIN_PASSWORD: "b" });

    assert.equal(table.callLog.length, 2);
    // Both calls should carry passwordHash in update branch (post-fix).
    // Pre-fix, the second call's update would be {} and assertion fails.
    assert.ok(table.callLog[0].update.passwordHash, "first call must have passwordHash in update");
    assert.ok(table.callLog[1].update.passwordHash, "second call must have passwordHash in update");
    assert.notEqual(table.callLog[0].update.passwordHash, table.callLog[1].update.passwordHash,
      "the two calls must carry distinct hashes (proves env propagation works)");
  });

  test("changing ADMIN_USERNAME creates a new row but does not delete the old one", async () => {
    // .env 里改用户名是另一种语义：会创建新 admin，旧的留在 DB 里。这也是
    // prisma upsert + where.username 的合理行为；记录下来防止以后误改。
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_USERNAME: "alice", ADMIN_PASSWORD: "pw" });
    await runSeedAdminStep(table, { ADMIN_USERNAME: "bob", ADMIN_PASSWORD: "pw" });

    assert.ok(table.findUnique({ where: { username: "alice" } }));
    assert.ok(table.findUnique({ where: { username: "bob" } }));
    assert.equal(table.rows.size, 2);
  });
});
