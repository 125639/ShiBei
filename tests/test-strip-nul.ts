import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripNulBytes } from "../src/lib/strip-nul";

const NUL = String.fromCharCode(0);

describe("stripNulBytes (guards Postgres text columns against 0x00 / error 22021)", () => {
  test("removes every NUL from strings but keeps other whitespace", () => {
    assert.equal(stripNulBytes(`ab${NUL}cd`), "abcd");
    assert.equal(stripNulBytes(`${NUL}x${NUL}${NUL}y${NUL}`), "xy");
    assert.equal(stripNulBytes("line1\nline2\tend"), "line1\nline2\tend");
    assert.equal(stripNulBytes("clean"), "clean");
  });

  test("recurses through plain objects and arrays", () => {
    const out = stripNulBytes({
      title: `a${NUL}b`,
      nested: { content: `x${NUL}y` },
      list: [`p${NUL}q`, "z"],
    });
    assert.equal(out.title, "ab");
    assert.equal(out.nested.content, "xy");
    assert.deepEqual(out.list, ["pq", "z"]);
    assert.equal(JSON.stringify(out).includes(NUL), false);
  });

  test("preserves Date and other non-plain values untouched", () => {
    const when = new Date("2026-07-14T00:00:00.000Z");
    const out = stripNulBytes({ when, n: 5, flag: true, empty: null, u: undefined });
    assert.ok(out.when instanceof Date);
    assert.equal(out.when.getTime(), when.getTime());
    assert.equal(out.n, 5);
    assert.equal(out.flag, true);
    assert.equal(out.empty, null);
    assert.equal(out.u, undefined);
  });

  // 该函数现在挂在 Prisma 扩展上跑每一条查询：干净输入必须 === 原对象（零分配），
  // 且只有含 NUL 的分支被拷贝、干净的兄弟分支保持原引用。
  test("returns the exact same reference when input is already clean", () => {
    const clean = { where: { id: "x" }, data: { title: "ok", list: ["a", "b"], at: new Date() } };
    assert.equal(stripNulBytes(clean), clean);
    assert.equal(stripNulBytes(clean.data.list), clean.data.list);
    const cleanArr = [{ a: "1" }, { b: "2" }];
    assert.equal(stripNulBytes(cleanArr), cleanArr);
  });

  test("copies only the dirty branches and keeps clean siblings by reference", () => {
    const cleanSibling = { keep: "me" };
    const input = { dirty: `a${NUL}b`, cleanSibling };
    const out = stripNulBytes(input);
    assert.notEqual(out, input);
    assert.equal(out.dirty, "ab");
    assert.equal(out.cleanSibling, cleanSibling);
    // 原对象不被就地修改
    assert.equal(input.dirty, `a${NUL}b`);
  });
});
