import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bearerTokenMatches } from "../src/lib/sync/token";

const TOKEN = "s3cr3t-shared-sync-token-1234567890";

describe("bearerTokenMatches (constant-time sync token check)", () => {
  test("accepts only the exact `Bearer <token>` header", () => {
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  });

  test("rejects wrong, partial, extended and differently-cased headers", () => {
    for (const header of [
      `Bearer wrong`,
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer `,
      `bearer ${TOKEN}`, // scheme is case-sensitive here
      TOKEN, // missing scheme
      "",
    ]) {
      assert.equal(bearerTokenMatches(header, TOKEN), false, header);
    }
  });

  test("fails closed when the configured token is missing", () => {
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}`, ""), false);
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}`, null), false);
    assert.equal(bearerTokenMatches(`Bearer ${TOKEN}`, undefined), false);
  });

  test("tolerates null/undefined authorization header", () => {
    assert.equal(bearerTokenMatches(null, TOKEN), false);
    assert.equal(bearerTokenMatches(undefined, TOKEN), false);
  });
});
