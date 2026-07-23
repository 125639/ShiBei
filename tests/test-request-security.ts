import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { isSameOriginMutation } from "../src/lib/request-origin";
import { parseJsonBody } from "../src/lib/request-validation";
import { backendProxyHeaders } from "../src/lib/sync/proxy";

const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv(
  name: "PUBLIC_URL" | "NEXT_PUBLIC_SITE_URL" | "TRUST_PROXY_HOPS",
  value: string | undefined
) {
  if (value === undefined) delete mutableEnv[name];
  else mutableEnv[name] = value;
}

describe("request mutation security", () => {
  test("JSON parser rejects simple text/plain and form requests before parsing", async () => {
    const schema = z.object({ action: z.string() });
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const result = await parseJsonBody(
        new Request("https://app.example/api/member/login", {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: JSON.stringify({ action: "mutate" })
        }),
        schema
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 415);
    }
  });

  test("JSON parser accepts application/json with a charset", async () => {
    const result = await parseJsonBody(
      new Request("https://app.example/api/public/test", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ action: "ok" })
      }),
      z.object({ action: z.literal("ok") })
    );
    assert.equal(result.ok, true);
  });

  test("rejects sibling/cross-site/null origins even when cookies are same-site", () => {
    for (const origin of ["https://evil.example.com", "https://other.test", "null", "not a url"]) {
      const request = new Request("https://app.example.com/api/admin/community-works/id", {
        method: "DELETE",
        headers: { Origin: origin, "Sec-Fetch-Site": "same-site" }
      });
      assert.equal(isSameOriginMutation(request), false, origin);
    }
  });

  test("allows exact same-origin browser mutations and non-browser authenticated calls", () => {
    assert.equal(isSameOriginMutation(new Request("https://app.example.com/api/member/logout", {
      method: "POST",
      headers: { Origin: "https://app.example.com", "Sec-Fetch-Site": "same-origin" }
    })), true);
    assert.equal(isSameOriginMutation(new Request("https://app.example.com/api/internal", {
      method: "POST"
    })), true);
  });

  test("PUBLIC_URL supplies the browser origin when the server request URL is internal", () => {
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    try {
      process.env.PUBLIC_URL = "https://app.example.com";
      process.env.NEXT_PUBLIC_SITE_URL = "https://stale.example.com";
      assert.equal(isSameOriginMutation(new Request("http://internal:3000/api/member/logout", {
        method: "POST",
        headers: { Origin: "https://app.example.com", "Sec-Fetch-Site": "same-origin" }
      })), true);
      assert.equal(isSameOriginMutation(new Request("http://internal:3000/api/member/logout", {
        method: "POST",
        headers: { Origin: "https://stale.example.com", "Sec-Fetch-Site": "same-site" }
      })), false);
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    }
  });

  test("allows the browser-visible Host when Next canonicalizes Request.url", () => {
    const request = new Request("http://localhost:3000/api/admin/login", {
      method: "POST",
      headers: {
        Host: "203.0.113.10:3000",
        Origin: "http://203.0.113.10:3000",
        "Sec-Fetch-Site": "same-origin"
      }
    });
    assert.equal(isSameOriginMutation(request), true);

    for (const site of ["same-site", "cross-site", "none"]) {
      const forged = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          Host: "203.0.113.10:3000",
          Origin: "http://203.0.113.10:3000",
          "Sec-Fetch-Site": site
        }
      });
      assert.equal(isSameOriginMutation(forged), false, site);
    }
  });

  test("allows a trusted forwarded origin for route handlers behind the ingress proxy", () => {
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.PUBLIC_URL = "https://canonical.example.test";
      delete mutableEnv.NEXT_PUBLIC_SITE_URL;
      process.env.TRUST_PROXY_HOPS = "1";
      const request = new Request("http://internal:3000/api/admin/sync/pull", {
        method: "POST",
        headers: {
          Host: "internal:3000",
          Origin: "https://front.example.test",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "front.example.test",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(request), true);
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
      restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
    }
  });

  test("ignores forged forwarded origins without an explicitly trusted proxy", () => {
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
    try {
      process.env.PUBLIC_URL = "https://canonical.example.test";
      delete mutableEnv.NEXT_PUBLIC_SITE_URL;
      process.env.TRUST_PROXY_HOPS = "0";
      const request = new Request("http://internal:3000/api/admin/sync/pull", {
        method: "POST",
        headers: {
          Host: "internal:3000",
          Origin: "https://front.example.test",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "front.example.test",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(request), false);
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
      restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
    }
  });

  test("rejects malformed Host values in the dynamic-origin fallback", () => {
    for (const host of ["evil.test@app.example", "app.example, evil.test", "app.example/path"] ) {
      const request = new Request("http://localhost:3000/api/member/logout", {
        method: "POST",
        headers: { Host: host, Origin: "https://app.example", "Sec-Fetch-Site": "same-origin" }
      });
      assert.equal(isSameOriginMutation(request), false, host);
    }
  });

  test("missing Origin fails closed for browser cross/same-site requests", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      assert.equal(isSameOriginMutation(new Request("https://app.example.com/api/member/logout", {
        method: "POST",
        headers: { "Sec-Fetch-Site": site }
      })), false, site);
    }
  });

  test("split-mode proxy removes browser origin metadata on the authenticated server hop", () => {
    const forwarded = backendProxyHeaders(new Request("https://front.example/api/public/creation/ai", {
      method: "POST",
      headers: {
        Origin: "https://front.example",
        Referer: "https://front.example/create",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        Cookie: "victim=session",
        Authorization: "browser-value",
        "Content-Type": "application/json",
        "X-Request-Id": "keep-me"
      },
      body: "{}"
    }));
    for (const stripped of ["origin", "referer", "sec-fetch-site", "sec-fetch-mode", "cookie", "authorization"]) {
      assert.equal(forwarded.has(stripped), false, stripped);
    }
    assert.equal(forwarded.get("content-type"), "application/json");
    assert.equal(forwarded.get("x-request-id"), "keep-me");
  });
});
