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

function restoreEnv(name: "NODE_ENV" | "NEXT_PUBLIC_SITE_URL", value: string | undefined) {
  if (value === undefined) delete mutableEnv[name];
  else mutableEnv[name] = value;
}

test("production credentials use host-only prefix requirements and never share legacy names", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    mutableEnv.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "http://misconfigured.example.test";

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
    assert.equal(shouldUseSecureCookies(), true, "production must fail closed with Secure");
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousSiteUrl);
  }
});

test("development credentials use an explicit isolated namespace", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    mutableEnv.NODE_ENV = "development";
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
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousSiteUrl);
  }
});
