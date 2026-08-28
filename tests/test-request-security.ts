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
    // 这条用例的前提是「没有可信反代」：此时 Host 派生的源只有在 Fetch Metadata
    // 明确说同源时才被接受。必须显式固定 TRUST_PROXY_HOPS 与 PUBLIC_URL——
    // @prisma/client 在 import 时会自动加载项目 .env，开发者本机若配了
    // TRUST_PROXY_HOPS=1，forwardedOrigin 就会把 Host 派生源直接放进白名单，
    // 这条用例便会以「同站请求也被放行」的形式假失败。
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
    try {
      delete mutableEnv.PUBLIC_URL;
      delete mutableEnv.NEXT_PUBLIC_SITE_URL;
      process.env.TRUST_PROXY_HOPS = "0";

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
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
      restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
    }
  });

  test("tunnel logins (cloudflared, no X-Forwarded-Host) pass CSRF via preserved Host", () => {
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
    try {
      // cloudflared 转发形态：保留公网 Host + X-Forwarded-Proto，不发 X-Forwarded-Host。
      // TRUST_PROXY_HOPS=1 时浏览器所在的公网源必须进入同源白名单，
      // 否则隧道用户的全部写请求（登录/发评论/后台操作）都会被 403。
      process.env.PUBLIC_URL = "http://localhost:8884";
      delete mutableEnv.NEXT_PUBLIC_SITE_URL;
      process.env.TRUST_PROXY_HOPS = "1";
      const login = new Request("http://127.0.0.1:8884/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test",
          Origin: "https://blog.example.test",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Proto": "https",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: "admin", password: "x" })
      });
      assert.equal(isSameOriginMutation(login), true);

      // 姊妹域/仿冒域即使经过可信代理也必须拒绝。
      const forged = new Request("http://127.0.0.1:8884/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test",
          Origin: "https://evil.example.test",
          "Sec-Fetch-Site": "cross-site",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(forged), false);

      // 直连部署（无可信代理）时没有可信依据采信转发头；此时只剩浏览器
      // Fetch Metadata 兜底路径——不带 Sec-Fetch-Site 的调用必须被拒，
      // 姊妹域即使带 same-origin 元数据也因 Host 不匹配被拒。
      process.env.TRUST_PROXY_HOPS = "0";
      const direct = new Request("http://127.0.0.1:8884/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test",
          Origin: "https://blog.example.test",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(direct), false);

      const sibling = new Request("http://127.0.0.1:8884/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test",
          Origin: "https://evil.example.test",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(sibling), false);
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
      restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
    }
  });

  test("non-standard-port nginx (XFH stripped of port) still passes CSRF", () => {
    const previousPublicUrl = process.env.PUBLIC_URL;
    const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
    try {
      // 浏览器 Origin 带端口（:8443），nginx 的 X-Forwarded-Host（$host）不带——
      // 同源白名单必须用补全端口后的 Host 还原，否则登录/写操作全部 403。
      process.env.PUBLIC_URL = "http://localhost:3000";
      delete mutableEnv.NEXT_PUBLIC_SITE_URL;
      process.env.TRUST_PROXY_HOPS = "1";
      const request = new Request("http://127.0.0.1:3000/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test:8443",
          Origin: "https://blog.example.test:8443",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "blog.example.test",
          "X-Forwarded-Proto": "https",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "username=admin&password=x"
      });
      assert.equal(isSameOriginMutation(request), true);

      // 端口不同的姊妹源依旧拒绝。
      const wrongPort = new Request("http://127.0.0.1:3000/api/admin/login", {
        method: "POST",
        headers: {
          Host: "blog.example.test:8443",
          Origin: "https://blog.example.test:9443",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "blog.example.test",
          "X-Forwarded-Proto": "https"
        }
      });
      assert.equal(isSameOriginMutation(wrongPort), false);
    } finally {
      restoreEnv("PUBLIC_URL", previousPublicUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
      restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
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
