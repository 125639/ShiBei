import assert from "node:assert/strict";
import test from "node:test";
import {
  ListPaginationError,
  decodeDescendingUpdatedAtCursor,
  finishDescendingUpdatedAtPage,
  identityBoundListScope,
  parseListPageRequest
} from "../src/lib/list-pagination";

process.env.AUTH_SECRET ||= "pagination-test-secret-that-is-long-enough";

test("descending updatedAt+id cursors traverse identical timestamps without duplicates or omissions", () => {
  const scope = identityBoundListScope("works", { memberId: "member-a" });
  const timestamp = new Date("2026-07-13T12:00:00.000Z");
  const rows = Array.from({ length: 103 }, (_, index) => ({
    id: `work-${String(index + 1).padStart(3, "0")}`,
    updatedAt: timestamp
  })).sort((left, right) => right.id.localeCompare(left.id));

  const collected: string[] = [];
  let remaining = rows;
  let cursor: string | null = null;
  do {
    const page = finishDescendingUpdatedAtPage(scope, remaining.slice(0, 26), 25);
    collected.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor) {
      const decoded = decodeDescendingUpdatedAtCursor(scope, cursor);
      assert.ok(decoded);
      remaining = rows.filter((row) =>
        row.updatedAt < decoded.updatedAt
        || (row.updatedAt.getTime() === decoded.updatedAt.getTime() && row.id < decoded.id)
      );
    }
  } while (cursor);

  assert.deepEqual(collected, rows.map((row) => row.id));
  assert.equal(new Set(collected).size, 103);
});

test("a cursor is bound to its list and active identity without exposing the identity token", () => {
  const anonToken = "private-http-only-anon-token";
  const anonScope = identityBoundListScope("writing-docs", { anonId: anonToken });
  const otherScope = identityBoundListScope("writing-docs", { anonId: "another-token" });
  const cursor = finishDescendingUpdatedAtPage(anonScope, [
    { id: "doc-2", updatedAt: new Date("2026-07-13T00:00:00.000Z") },
    { id: "doc-1", updatedAt: new Date("2026-07-12T00:00:00.000Z") }
  ], 1).nextCursor;

  assert.ok(cursor);
  assert.equal(Buffer.from(cursor, "base64url").toString("utf8").includes(anonToken), false);
  assert.throws(
    () => decodeDescendingUpdatedAtCursor(otherScope, cursor),
    ListPaginationError
  );
  assert.throws(
    () => decodeDescendingUpdatedAtCursor(identityBoundListScope("creation-works", { anonId: anonToken }), cursor),
    ListPaginationError
  );
});

test("pageSize is bounded and malformed cursors fail closed", () => {
  const options = { scope: "test-scope", defaultPageSize: 50, maxPageSize: 100 };
  assert.equal(parseListPageRequest("https://example.test/api", options).pageSize, 50);
  assert.equal(parseListPageRequest("https://example.test/api?pageSize=100", options).pageSize, 100);
  for (const query of ["pageSize=0", "pageSize=101", "pageSize=1.5", "pageSize=abc", "cursor=not-json"]) {
    assert.throws(
      () => parseListPageRequest(`https://example.test/api?${query}`, options),
      ListPaginationError
    );
  }
});
