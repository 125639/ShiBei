export const AUTH_COOKIE_NAMES = Object.freeze({
  adminSession: Object.freeze([
    "__Host-shibei_admin_session",
    "shibei_dev_admin_session"
  ]),
  memberSession: Object.freeze([
    "__Host-shibei_member_session",
    "shibei_dev_member_session"
  ]),
  memberCredentialUpgrade: Object.freeze([
    "__Host-shibei_member_credential_upgrade",
    "shibei_dev_member_credential_upgrade"
  ]),
  anonymousIdentity: Object.freeze([
    "__Host-shibei_anon_id",
    "shibei_dev_anon_id"
  ])
});

export const LEGACY_AUTH_COOKIE_NAMES = Object.freeze({
  adminSession: "shibei_admin_session",
  memberSession: "shibei_member_session",
  memberCredentialUpgrade: "shibei_member_credential_upgrade",
  anonymousIdentity: "shibei_anon_id"
});

export function cookieHeaderForAuthValue(kind, value) {
  return AUTH_COOKIE_NAMES[kind].map((name) => `${name}=${value}`).join("; ");
}

export function setCookieValues(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
}

export function authCookieFrom(response, kind) {
  for (const header of setCookieValues(response)) {
    for (const item of header.split(/,(?=[^;,]+=)/)) {
      const pair = item.trim().split(";", 1)[0];
      if (AUTH_COOKIE_NAMES[kind].some((name) => pair.startsWith(`${name}=`) && pair.length > name.length + 1)) {
        return pair;
      }
    }
  }
  throw new Error(`response did not set a non-empty ${kind} cookie`);
}

export function authCookieValue(pair) {
  const separator = pair.indexOf("=");
  if (separator < 1) throw new Error("invalid cookie pair");
  return pair.slice(separator + 1);
}
