import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { getSyncConfig } from "../src/lib/app-mode";
import { backendFetchInitForConfig } from "../src/lib/sync/config";
import {
  assertBackendUrl,
  BackendUrlValidationError,
  normalizeBackendUrl,
} from "../src/lib/sync/backend-url";

describe("frontend to backend transport boundary", () => {
  test("accepts and normalizes public HTTPS origins", () => {
    assert.equal(assertBackendUrl(" https://api.example.com:8443/ "), "https://api.example.com:8443");
  });

  test("accepts HTTP only on loopback, private networks, CGNAT and Docker service names", () => {
    for (const value of [
      "http://localhost:3300",
      "http://127.0.0.1:3300",
      "http://10.0.0.8:3000",
      "http://100.64.1.2:3000",
      "http://172.31.0.8:3000",
      "http://192.168.1.8:3000",
      "http://[fd7a:115c:a1e0::1]:3000",
      "http://app:3000",
    ]) {
      assert.equal(assertBackendUrl(value), new URL(value).origin, value);
    }
  });

  test("rejects plaintext public hosts and IPs so SYNC_TOKEN cannot cross them", () => {
    for (const value of [
      "http://backend.example.com:3000",
      "http://8.8.8.8:3000",
      "http://203.0.113.10:3000",
    ]) {
      assert.throws(() => assertBackendUrl(value), BackendUrlValidationError, value);
      assert.equal(normalizeBackendUrl(value), "", value);
    }
  });

  test("rejects credentials, paths, queries, fragments and non-HTTP protocols", () => {
    for (const value of [
      "https://user:pass@api.example.com",
      "https://api.example.com/base",
      "https://api.example.com?tenant=a",
      "https://api.example.com#fragment",
      "https://api.example.com:0",
      "ftp://api.example.com",
      "not a url",
    ]) {
      assert.throws(() => assertBackendUrl(value), BackendUrlValidationError, value);
    }
  });

  test("empty values remain a valid unconfigured state", () => {
    assert.equal(assertBackendUrl(""), "");
    assert.equal(normalizeBackendUrl(undefined), "");
  });

  test("runtime env fails closed instead of sending a token to public HTTP", () => {
    const previousUrl = process.env.BACKEND_API_URL;
    const previousToken = process.env.SYNC_TOKEN;
    try {
      process.env.BACKEND_API_URL = "http://backend.example.com:3000";
      process.env.SYNC_TOKEN = "do-not-send-over-plaintext";
      assert.equal(getSyncConfig().backendUrl, "");

      process.env.BACKEND_API_URL = "http://10.0.0.8:3000/";
      assert.equal(getSyncConfig().backendUrl, "http://10.0.0.8:3000");
    } finally {
      if (previousUrl === undefined) delete process.env.BACKEND_API_URL;
      else process.env.BACKEND_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.SYNC_TOKEN;
      else process.env.SYNC_TOKEN = previousToken;
    }
  });

  test("admin save route validates transport before persisting the backend URL", () => {
    const source = readFileSync(
      new URL("../src/app/api/admin/sync/config/route.ts", import.meta.url),
      "utf8"
    );
    const validation = source.indexOf("assertBackendUrl(form.get");
    const persistence = source.indexOf("prisma.siteSettings.upsert");
    assert.ok(validation >= 0 && persistence > validation);
    assert.match(source, /configError=unsafe-backend-url/);
  });

  test("backend bearer requests refuse redirects and overwrite caller authorization", () => {
    const init = backendFetchInitForConfig(
      { syncToken: "shared-secret" },
      { headers: { Authorization: "Bearer browser-value" }, redirect: "follow" }
    );
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer shared-secret");
  });
});
