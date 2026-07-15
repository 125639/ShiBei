import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  INTERNAL_REVALIDATION_SIGNATURE_HEADER,
  INTERNAL_REVALIDATION_TIMESTAMP_HEADER,
  normalizePublicRevalidationPath,
  signInternalRevalidationRequest,
  verifyInternalRevalidationRequest
} from "../src/lib/internal-revalidation";
import { notifyPublicContentRevalidation } from "../src/worker/public-cache";

const SECRET = "test-auth-secret-that-must-never-cross-the-wire";
const NOW = 1_783_990_000_000;

describe("signed internal public-cache revalidation", () => {
  test("authenticates the exact body without transmitting AUTH_SECRET", () => {
    const body = JSON.stringify({ paths: ["/posts/example"] });
    const timestamp = String(NOW);
    const signature = signInternalRevalidationRequest({ body, timestamp, secret: SECRET });

    assert.match(signature, /^v1=[a-f0-9]{64}$/);
    assert.equal(signature.includes(SECRET), false);
    assert.deepEqual(
      verifyInternalRevalidationRequest({ body, timestamp, signature, secret: SECRET, now: NOW }),
      { ok: true }
    );
    assert.equal(
      verifyInternalRevalidationRequest({
        body: `${body} `,
        timestamp,
        signature,
        secret: SECRET,
        now: NOW
      }).ok,
      false
    );
  });

  test("rejects stale and far-future signed requests", () => {
    const body = "{\"paths\":[]}";
    for (const timestamp of [String(NOW - 300_001), String(NOW + 300_001)]) {
      const signature = signInternalRevalidationRequest({ body, timestamp, secret: SECRET });
      assert.deepEqual(
        verifyInternalRevalidationRequest({ body, timestamp, signature, secret: SECRET, now: NOW }),
        { ok: false, reason: "expired" }
      );
    }
  });

  test("worker sends a verifiable request and de-duplicates paths", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const result = await notifyPublicContentRevalidation(
      ["/posts/example", "/posts/example", null],
      {
        baseUrl: "http://app:3000",
        secret: SECRET,
        now: () => NOW,
        fetchImpl: async (input, init) => {
          captured = { url: String(input), init: init || {} };
          return new Response(null, { status: 204 });
        }
      }
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(captured?.url, "http://app:3000/api/internal/revalidate-public");
    const body = String(captured?.init.body);
    assert.equal(body, JSON.stringify({ paths: ["/posts/example"] }));
    const headers = new Headers(captured?.init.headers);
    assert.deepEqual(
      verifyInternalRevalidationRequest({
        body,
        timestamp: headers.get(INTERNAL_REVALIDATION_TIMESTAMP_HEADER),
        signature: headers.get(INTERNAL_REVALIDATION_SIGNATURE_HEADER),
        secret: SECRET,
        now: NOW
      }),
      { ok: true }
    );
    assert.equal(body.includes(SECRET), false);
    assert.equal(JSON.stringify([...headers]).includes(SECRET), false);
  });

  test("worker logs delivery failures instead of throwing", async () => {
    const warnings: string[] = [];
    const result = await notifyPublicContentRevalidation(["/posts/example"], {
      baseUrl: "http://app:3000",
      secret: SECRET,
      attempts: 1,
      logger: { warn: (message) => warnings.push(String(message)) },
      fetchImpl: async () => {
        throw new Error("connection refused");
      }
    });
    assert.equal(result.ok, false);
    assert.match(warnings.join("\n"), /不会回滚/);
    assert.equal(warnings.join("\n").includes(SECRET), false);
  });

  test("rejects paths that could escape or change URL semantics", () => {
    assert.equal(normalizePublicRevalidationPath("/posts/valid-slug"), "/posts/valid-slug");
    for (const invalid of ["posts/no-leading-slash", "//evil.test/x", "/posts/../admin", "/posts/%2e%2e/admin", "/x?y=1", "/x%3fy=1", "/x#y", "/x\\y"]) {
      assert.equal(normalizePublicRevalidationPath(invalid), null, invalid);
    }
  });
});
