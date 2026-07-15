import assert from "node:assert/strict";
import test from "node:test";
import {
  ANON_BOOTSTRAP_HEADER,
  ANON_CREATION_SEED_HEADER,
  anonCreationSeedFromRequest,
  anonBootstrapRequestRejection,
  deriveAnonIdFromBootstrapSeed
} from "../src/lib/anon-bootstrap";

const APP_ORIGIN = "https://app.example.test";
const SEED = "5f728f9d-0a2e-4db5-89ac-5ea93df3eb21";

function bootstrapRequest(headers: Record<string, string> = {}) {
  return new Request(`${APP_ORIGIN}/api/public/anon/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ANON_BOOTSTRAP_HEADER]: "1",
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers
    },
    body: JSON.stringify({ seed: SEED })
  });
}

test("bootstrap identity is deterministic HMAC output, not the client seed", () => {
  const secret = new TextEncoder().encode("unit-test-secret");
  const first = deriveAnonIdFromBootstrapSeed(SEED, secret);
  const second = deriveAnonIdFromBootstrapSeed(SEED.toUpperCase(), secret);
  const otherSeed = deriveAnonIdFromBootstrapSeed(
    "e6bf30c9-fdf0-40c8-b47f-a2424417ed68",
    secret
  );
  const otherSecret = deriveAnonIdFromBootstrapSeed(SEED, new TextEncoder().encode("other-secret"));

  assert.equal(first, second);
  assert.match(first, /^anon_v1_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.includes(SEED), false);
  assert.notEqual(first, otherSeed);
  assert.notEqual(first, otherSecret);
});

test("anonymous creation seed binding accepts only a valid UUID header", () => {
  const request = new Request(`${APP_ORIGIN}/api/public/writing/docs`, {
    method: "POST",
    headers: { [ANON_CREATION_SEED_HEADER]: SEED.toUpperCase() }
  });
  assert.equal(anonCreationSeedFromRequest(request), SEED);
  assert.equal(
    anonCreationSeedFromRequest(new Request(`${APP_ORIGIN}/api/public/writing/docs`)),
    null
  );
  assert.equal(
    anonCreationSeedFromRequest(new Request(`${APP_ORIGIN}/api/public/writing/docs`, {
      headers: { [ANON_CREATION_SEED_HEADER]: "not-a-uuid" }
    })),
    null
  );
});

test("valid production same-origin JSON request is accepted", () => {
  assert.equal(
    anonBootstrapRequestRejection(bootstrapRequest(), {
      production: true,
      siteUrl: APP_ORIGIN
    }),
    null
  );
});

test("production accepts a matching trusted forwarded host", () => {
  const request = new Request("http://internal:3000/api/public/anon/bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ANON_BOOTSTRAP_HEADER]: "1",
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "app.example.test",
      "x-forwarded-proto": "https"
    },
    body: JSON.stringify({ seed: SEED })
  });
  assert.equal(anonBootstrapRequestRejection(request, { production: true }), null);
});

test("cross-site requests and mismatched production origins are rejected", () => {
  const crossSite = bootstrapRequest({
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site"
  });
  assert.equal(anonBootstrapRequestRejection(crossSite, { production: false })?.status, 403);

  const mismatched = bootstrapRequest({ origin: "https://evil.example" });
  assert.equal(
    anonBootstrapRequestRejection(mismatched, { production: true, siteUrl: APP_ORIGIN })?.status,
    403
  );

  const missingOrigin = bootstrapRequest({ origin: "" });
  assert.equal(
    anonBootstrapRequestRejection(missingOrigin, { production: true, siteUrl: APP_ORIGIN })?.status,
    403
  );
});

test("simple CSRF content types and missing confirmation header fail", () => {
  const text = bootstrapRequest({ "content-type": "text/plain" });
  const form = bootstrapRequest({ "content-type": "application/x-www-form-urlencoded" });
  const missingHeader = bootstrapRequest({ [ANON_BOOTSTRAP_HEADER]: "" });

  assert.equal(anonBootstrapRequestRejection(text, { production: false })?.status, 415);
  assert.equal(anonBootstrapRequestRejection(form, { production: false })?.status, 415);
  assert.equal(anonBootstrapRequestRejection(missingHeader, { production: false })?.status, 403);
});
