// 集成测试：模拟 seed.ts 的实际工作流，验证 .env 密码确实变化时才同步 hash
// 并吊销旧会话；普通重启保持原 hash / tokenVersion，不会强制管理员退出。
//
// 跑法（需要 bcryptjs，运行前 `npm install bcryptjs` 在本目录）：
//   node --test tests/test-seed-integration.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  adminUsernameFromEnv,
  buildAdminCreateData,
  buildAdminPasswordRotationData
} from "../prisma/seed-helpers.mjs";

// 内存里的"数据库"：键是 username，值含 passwordHash / tokenVersion。
class FakeAdminUserTable {
  constructor() {
    this.rows = new Map();
    this.callLog = [];
  }
  async create({ data }) {
    const row = { id: `admin-${this.rows.size + 1}`, tokenVersion: 0, ...data };
    this.callLog.push({ operation: "create", data: { ...data } });
    this.rows.set(row.username, row);
    return row;
  }
  async update({ where, data }) {
    const existing = [...this.rows.values()].find((row) => row.id === where.id);
    assert.ok(existing, "updated admin must exist");
    const next = {
      ...existing,
      passwordHash: data.passwordHash ?? existing.passwordHash,
      tokenVersion: data.tokenVersion?.increment
        ? existing.tokenVersion + data.tokenVersion.increment
        : existing.tokenVersion
    };
    this.callLog.push({ operation: "update", where: { ...where }, data: structuredClone(data) });
    this.rows.set(next.username, next);
    return next;
  }
  findUnique({ where }) {
    return this.rows.get(where.username) ?? null;
  }
}

// 模拟 seed.ts：先读取并 bcrypt.compare；仅实际变化时 hash + update + version++。
async function runSeedAdminStep(table, env) {
  const password = env.ADMIN_PASSWORD || "change-me-now";
  const username = adminUsernameFromEnv(env);
  const existing = table.findUnique({ where: { username } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 4);
    return table.create({ data: buildAdminCreateData(env, passwordHash) });
  }
  if (await bcrypt.compare(password, existing.passwordHash)) return existing;
  const passwordHash = await bcrypt.hash(password, 4);
  return table.update({
    where: { id: existing.id },
    data: buildAdminPasswordRotationData(passwordHash)
  });
}

describe("seed admin password reconciliation — bcrypt + fake prisma", () => {
  test("first seed creates admin with .env password (bcrypt.compare succeeds)", async () => {
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "first-pw" });

    const row = table.findUnique({ where: { username: "admin" } });
    assert.ok(row, "admin user must exist after seed");
    assert.equal(await bcrypt.compare("first-pw", row.passwordHash), true);
    assert.equal(await bcrypt.compare("wrong-pw", row.passwordHash), false);
    assert.equal(row.tokenVersion, 0);
  });

  test("same ADMIN_PASSWORD on restart preserves hash and tokenVersion", async () => {
    const table = new FakeAdminUserTable();
    const env = { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "stable-password" };
    await runSeedAdminStep(table, env);
    const first = { ...table.findUnique({ where: { username: "admin" } }) };
    await runSeedAdminStep(table, env);
    const second = table.findUnique({ where: { username: "admin" } });

    assert.equal(second.passwordHash, first.passwordHash,
      "bcrypt must not be re-run and persisted on an ordinary restart");
    assert.equal(second.tokenVersion, 0,
      "ordinary restart must not revoke a valid administrator session");
    assert.deepEqual(table.callLog.map((entry) => entry.operation), ["create"]);
  });

  test("changed ADMIN_PASSWORD rotates hash and increments tokenVersion exactly once", async () => {
    // 这个用例直接复现 user 报告的场景：
    //   1) 第一次 wizard 跑，stdin EOF → 走默认密码 ihMZLmJ9YFmjIXzB → 数据库存这个 hash
    //   2) 用户重跑 wizard，写入 .env 新密码 x40YrL7qeqZYSa6V
    //   3) docker compose up -d → start-app.sh 跑 npm run db:seed 第二次
    //   4) 新密码同步时 tokenVersion 必须 +1，吊销用旧密码签发的所有 JWT
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
    assert.equal(afterFirst.tokenVersion, 0);
    assert.equal(afterSecond.tokenVersion, 1,
      "actual password change must invalidate every previously issued admin JWT");

    await runSeedAdminStep(table, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: newPw });
    const afterThird = table.findUnique({ where: { username: "admin" } });
    assert.equal(afterThird.passwordHash, afterSecond.passwordHash);
    assert.equal(afterThird.tokenVersion, 1,
      "subsequent restart with unchanged password must not revoke again");
  });

  test("call log records one create and only genuine rotations as updates", async () => {
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_PASSWORD: "a" });
    await runSeedAdminStep(table, { ADMIN_PASSWORD: "a" });
    await runSeedAdminStep(table, { ADMIN_PASSWORD: "b" });

    assert.equal(table.callLog.length, 2);
    assert.equal(table.callLog[0].operation, "create");
    assert.equal(table.callLog[1].operation, "update");
    assert.deepEqual(table.callLog[1].data.tokenVersion, { increment: 1 });
  });

  test("changing ADMIN_USERNAME creates a new row but does not delete the old one", async () => {
    // .env 里改用户名是另一种语义：会创建新 admin，旧的留在 DB 里。
    // 记录这一兼容行为，防止以后误改。
    const table = new FakeAdminUserTable();
    await runSeedAdminStep(table, { ADMIN_USERNAME: "alice", ADMIN_PASSWORD: "pw" });
    await runSeedAdminStep(table, { ADMIN_USERNAME: "bob", ADMIN_PASSWORD: "pw" });

    assert.ok(table.findUnique({ where: { username: "alice" } }));
    assert.ok(table.findUnique({ where: { username: "bob" } }));
    assert.equal(table.rows.size, 2);
  });
});
