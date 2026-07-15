import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuthCookieName,
  getAuthCookiePath,
  shouldUseSecureCookies,
  type AuthCookieKind
} from "../src/lib/auth";

const kinds: AuthCookieKind[] = [
  "adminSession",
  "memberSession",
  "memberCredentialUpgrade",
  "anonymousIdentity"
];
const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv(
  name: "NODE_ENV" | "PUBLIC_URL" | "NEXT_PUBLIC_SITE_URL",
  value: string | undefined
) {
  if (value === undefined) delete mutableEnv[name];
  else mutableEnv[name] = value;
}

test("HTTPS production credentials use host-only prefix requirements", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    mutableEnv.NODE_ENV = "production";
    process.env.PUBLIC_URL = "https://secure.example.test";
    // PUBLIC_URL is authoritative over a stale legacy value.
    process.env.NEXT_PUBLIC_SITE_URL = "http://legacy.example.test";

    assert.deepEqual(
      kinds.map((kind) => getAuthCookieName(kind)),
      [
        "__Host-shibei_admin_session",
        "__Host-shibei_member_session",
        "__Host-shibei_member_credential_upgrade",
        "__Host-shibei_anon_id"
      ]
    );
    assert.equal(kinds.every((kind) => getAuthCookiePath(kind) === "/"), true);
    assert.equal(shouldUseSecureCookies(), true);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousSiteUrl);
  }
});

test("HTTP production credentials use a separate host-only namespace", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    mutableEnv.NODE_ENV = "production";
    process.env.PUBLIC_URL = "http://127.0.0.1:3000";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;

    assert.deepEqual(
      kinds.map((kind) => getAuthCookieName(kind)),
      [
        "shibei_http_admin_session",
        "shibei_http_member_session",
        "shibei_http_member_credential_upgrade",
        "shibei_http_anon_id"
      ]
    );
    assert.equal(getAuthCookiePath("adminSession"), "/");
    assert.equal(getAuthCookiePath("memberSession"), "/");
    assert.equal(getAuthCookiePath("anonymousIdentity"), "/");
    assert.equal(
      getAuthCookiePath("memberCredentialUpgrade"),
      "/api/member/upgrade-credential"
    );
    assert.equal(shouldUseSecureCookies(), false);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousSiteUrl);
  }
});

test("development credentials use an explicit isolated namespace", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    mutableEnv.NODE_ENV = "development";
    delete mutableEnv.PUBLIC_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    const names = kinds.map((kind) => getAuthCookieName(kind));
    assert.deepEqual(names, [
      "shibei_dev_admin_session",
      "shibei_dev_member_session",
      "shibei_dev_member_credential_upgrade",
      "shibei_dev_anon_id"
    ]);
    assert.equal(names.every((name) => name.startsWith("shibei_dev_")), true);
    assert.equal(getAuthCookiePath("adminSession"), "/");
    assert.equal(getAuthCookiePath("memberSession"), "/");
    assert.equal(getAuthCookiePath("anonymousIdentity"), "/");
    assert.equal(
      getAuthCookiePath("memberCredentialUpgrade"),
      "/api/member/upgrade-credential"
    );
    assert.equal(shouldUseSecureCookies(), false);

    process.env.NEXT_PUBLIC_SITE_URL = "https://local.example.test";
    assert.equal(shouldUseSecureCookies(), true);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousSiteUrl);
  }
});
