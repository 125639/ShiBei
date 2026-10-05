import "next/dist/server/node-environment";
import assert from "node:assert/strict";
import test from "node:test";
import { languageRedirectLocation, proxy } from "../src/proxy";
import { adapter } from "next/dist/server/web/adapter";
import { redirectTo } from "../src/lib/redirect";
import {
  absoluteSiteUrl,
  configuredSiteOrigin,
  requestSiteOrigin,
  siteOrigin,
  trustedForwardedSiteOrigin
} from "../src/lib/site-url";

const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv(
  name: "PUBLIC_URL" | "NEXT_PUBLIC_SITE_URL" | "TRUST_PROXY_HOPS",
  value: string | undefined
) {
  if (value === undefined) delete mutableEnv[name];
  else mutableEnv[name] = value;
}

function withoutConfiguredUrl(run: () => void) {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    delete mutableEnv.PUBLIC_URL;
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    delete mutableEnv.TRUST_PROXY_HOPS;
    run();
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
}

test("PUBLIC_URL is runtime-authoritative and normalized to an HTTP origin", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.PUBLIC_URL = "https://current.example.test/";
    process.env.NEXT_PUBLIC_SITE_URL = "https://legacy.example.test";
    assert.equal(configuredSiteOrigin(), "https://current.example.test");
    assert.equal(siteOrigin(), "https://current.example.test");
    assert.equal(absoluteSiteUrl("posts/a"), "https://current.example.test/posts/a");

    // Changing the process environment changes the value without rebuilding.
    process.env.PUBLIC_URL = "http://new.example.test:8080";
    assert.equal(siteOrigin(), "http://new.example.test:8080");
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
  }
});

test("legacy NEXT_PUBLIC_SITE_URL remains a runtime fallback", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    delete mutableEnv.PUBLIC_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://legacy.example.test";
    assert.equal(configuredSiteOrigin(), "https://legacy.example.test");
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
  }
});

test("an explicitly invalid PUBLIC_URL fails closed instead of downgrading cookies", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.PUBLIC_URL = "javascript:alert(1)";
    process.env.NEXT_PUBLIC_SITE_URL = "https://legacy.example.test";
    assert.throws(() => configuredSiteOrigin(), /PUBLIC_URL/);
    assert.throws(() => siteOrigin(), /PUBLIC_URL/);
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
  }
});

test("configured URLs reject unsupported subpaths and invalid legacy values", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.PUBLIC_URL = "https://example.test/blog";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    assert.throws(() => configuredSiteOrigin(), /PUBLIC_URL/);

    delete mutableEnv.PUBLIC_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/?tenant=other";
    assert.throws(() => configuredSiteOrigin(), /NEXT_PUBLIC_SITE_URL/);
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
  }
});

test("direct HTTP redirects keep the request scheme instead of assuming HTTPS", () => {
  withoutConfiguredUrl(() => {
    const request = new Request("http://203.0.113.10:3000/api/admin/login", {
      method: "POST",
      headers: { Host: "203.0.113.10:3000" }
    });
    assert.equal(requestSiteOrigin(request), "http://203.0.113.10:3000");
    assert.equal(
      redirectTo("/admin", request).headers.get("location"),
      "/admin"
    );
  });
});

test("validated forwarding headers describe the external reverse-proxy origin", () => {
  withoutConfiguredUrl(() => {
    process.env.TRUST_PROXY_HOPS = "1";
    const request = new Request("http://internal:3000/api/admin/login", {
      method: "POST",
      headers: {
        Host: "internal:3000",
        "X-Forwarded-Host": "blog.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(request), "https://blog.example.test");

    const malformed = new Request("http://internal:3000/api/admin/login", {
      headers: {
        Host: "internal:3000",
        "X-Forwarded-Host": "evil.test@blog.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(malformed), "http://internal:3000");
  });
});

test("a direct listener ignores caller-controlled forwarding headers", () => {
  withoutConfiguredUrl(() => {
    process.env.TRUST_PROXY_HOPS = "0";
    const request = new Request("http://app.example.test:3000/api/admin/login", {
      headers: {
        Host: "app.example.test:3000",
        "X-Forwarded-Host": "attacker.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(request), "http://app.example.test:3000");
  });
});

test("configured PUBLIC_URL wins for direct listeners without a trusted proxy", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    process.env.PUBLIC_URL = "https://canonical.example.test";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    // 直连（无可信反代）时转发头不可信，必须保持 PUBLIC_URL 权威，
    // 防止攻击者用 Host/X-Forwarded-* 头制造开放重定向。
    process.env.TRUST_PROXY_HOPS = "0";
    const request = new Request("http://internal:3000/api/admin/login", {
      headers: {
        Host: "attacker.example.test",
        "X-Forwarded-Host": "attacker.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(request), "https://canonical.example.test");
    assert.equal(
      redirectTo("/admin", request).headers.get("location"),
      "/admin"
    );
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("behind a trusted proxy, redirects follow the browser-visible origin (cloudflare tunnel)", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    // 隧道部署的典型配置：PUBLIC_URL 指向本机直连地址，访客从公网域名进来。
    // cloudflared 不会发送 X-Forwarded-Host，但会原样保留公网 Host 并附上
    // X-Forwarded-Proto —— 重定向必须回到公网源，否则用户被带回
    // http://localhost:PORT 打不开的地址。
    process.env.PUBLIC_URL = "http://localhost:8884";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    process.env.TRUST_PROXY_HOPS = "1";
    const request = new Request("http://127.0.0.1:8884/api/admin/login", {
      method: "POST",
      headers: {
        Host: "blog.example.test",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": "203.0.113.7"
      }
    });
    assert.equal(requestSiteOrigin(request), "https://blog.example.test");
    assert.equal(
      redirectTo("/admin", request).headers.get("location"),
      "/admin"
    );
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("nginx-style proxies with X-Forwarded-Host resolve identically", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    process.env.PUBLIC_URL = "http://localhost:3000";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    process.env.TRUST_PROXY_HOPS = "1";
    const request = new Request("http://127.0.0.1:3000/api/admin/login", {
      method: "POST",
      headers: {
        Host: "internal:3000",
        "X-Forwarded-Host": "blog.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(request), "https://blog.example.test");
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("non-standard public ports survive X-Forwarded-Host without a port", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    // 443 不可用的服务器上 nginx 常监听 8443 之类的端口。nginx 惯用的
    // `proxy_set_header X-Forwarded-Host $host` 不携带端口，而浏览器 Host
    // 头带完整端口——还原源时必须保留端口，否则重定向/CSRF 全部错位。
    process.env.PUBLIC_URL = "http://localhost:3000";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    process.env.TRUST_PROXY_HOPS = "1";

    const request = new Request("http://127.0.0.1:3000/api/admin/login", {
      method: "POST",
      headers: {
        Host: "blog.example.test:8443",
        "X-Forwarded-Host": "blog.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(request), "https://blog.example.test:8443");
    assert.equal(
      redirectTo("/admin", request).headers.get("location"),
      "/admin"
    );

    // 端口不一致（XFH 显式带了另一个端口）说明代理刻意声明了对外端口，以 XFH 为准。
    const explicitPort = new Request("http://127.0.0.1:3000/api/admin/login", {
      headers: {
        Host: "blog.example.test:8443",
        "X-Forwarded-Host": "blog.example.test:9443",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(explicitPort), "https://blog.example.test:9443");

    // 域名被代理改写（Host=内部名）时以 XFH 为准，不继承内部端口。
    const rewritten = new Request("http://127.0.0.1:3000/api/admin/login", {
      headers: {
        Host: "internal:3000",
        "X-Forwarded-Host": "blog.example.test",
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(requestSiteOrigin(rewritten), "https://blog.example.test");
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("trusted forwarded origin falls back to Host when X-Forwarded-Host is absent", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    process.env.PUBLIC_URL = "http://localhost:8884";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;

    process.env.TRUST_PROXY_HOPS = "1";
    const tunneled = new Request("http://127.0.0.1:8884/api/admin/login", {
      headers: { Host: "blog.example.test", "X-Forwarded-Proto": "https" }
    });
    assert.equal(trustedForwardedSiteOrigin(tunneled), "https://blog.example.test");

    process.env.TRUST_PROXY_HOPS = "0";
    assert.equal(trustedForwardedSiteOrigin(tunneled), null);

    process.env.TRUST_PROXY_HOPS = "1";
    const malformed = new Request("http://127.0.0.1:8884/api/admin/login", {
      headers: { Host: "evil.test@blog.example.test", "X-Forwarded-Proto": "https" }
    });
    assert.equal(trustedForwardedSiteOrigin(malformed), null);
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousLegacyUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("language redirects target the visitor-facing origin, never the internal one", () => {
  // 这条用例锁定一个只在反代/隧道后面才会暴露的 bug：中间件若用
  // request.nextUrl 直接拼 Location，访客会被 307 到 http://127.0.0.1:PORT，
  // 也就是他自己的本机。本地直连时测不出来，因为那时两者恰好相同。
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousTrustedProxyHops = process.env.TRUST_PROXY_HOPS;
  try {
    process.env.PUBLIC_URL = "http://localhost:8884";
    process.env.TRUST_PROXY_HOPS = "1";

    const throughTunnel = {
      url: "http://127.0.0.1:8884/posts",
      headers: new Headers({
        host: "blog.example.com",
        "x-forwarded-proto": "https",
        "accept-language": "zh-CN,zh;q=0.9"
      })
    };
    assert.equal(
      languageRedirectLocation(throughTunnel, "/posts", ""),
      "/zh/posts"
    );
    // 查询串必须保留，否则 /posts?topic=x 重定向后丢掉筛选条件
    assert.equal(
      languageRedirectLocation(throughTunnel, "/posts", "?topic=tech&q=ai"),
      "/zh/posts?topic=tech&q=ai"
    );
    // Accept-Language 决定落地语种
    assert.equal(
      languageRedirectLocation(
        { url: "http://127.0.0.1:8884/", headers: new Headers({ host: "blog.example.com", "x-forwarded-proto": "https", "accept-language": "en-US,en;q=0.9" }) },
        "/",
        ""
      ),
      "/en"
    );
  } finally {
    restoreEnv("PUBLIC_URL", previousPublicUrl);
    restoreEnv("TRUST_PROXY_HOPS", previousTrustedProxyHops);
  }
});

test("language redirects skip paths that have no language version", () => {
  const req = { url: "http://127.0.0.1:8884/x", headers: new Headers({ "accept-language": "zh-CN" }) };
  for (const p of ["/admin", "/admin/login", "/api/public/visit", "/uploads/image/a.png", "/feed.xml", "/robots.txt", "/sitemap.xml"]) {
    assert.equal(languageRedirectLocation(req, p, ""), null, `应豁免: ${p}`);
  }
  // 带扩展名的根级静态文件（浏览器默认请求 favicon 等）
  assert.equal(languageRedirectLocation(req, "/favicon.ico", ""), null);
  assert.equal(languageRedirectLocation(req, "/firefly-banner.svg", ""), null);
  // 已带语言段的不再重定向（否则会无限循环）
  assert.equal(languageRedirectLocation(req, "/zh/posts", ""), null);
  assert.equal(languageRedirectLocation(req, "/en", ""), null);
});

test("all in-site redirects retain the browser's HTTPS origin despite stale deployment URLs", () => {
  const saved = { PUBLIC_URL: process.env.PUBLIC_URL, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL, TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS };
  try {
    for (const configured of ["http://127.0.0.1:8884", "http://203.0.113.10:8884", "https://old.example.test", ""]) {
      process.env.PUBLIC_URL = configured;
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      for (const hops of ["0", "1", "2"]) {
        process.env.TRUST_PROXY_HOPS = hops;
        for (const headers of [
          {},
          { host: "127.0.0.1:8884" },
          { host: "backend_internal", "x-forwarded-proto": "http" },
          { host: "test.example.com", "x-forwarded-proto": "https" },
          { host: "internal:3000", "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" }
        ]) {
          const request = new Request("http://127.0.0.1:8884/api/admin/login", { headers: headers as Record<string, string> });
          for (const path of ["/admin", "/admin/login?error=1", "/admin/settings?tab=models", "/admin/posts?publishError=blocked"]) {
            for (const response of [redirectTo(path), redirectTo(path, request), redirectTo(path, 307)]) {
              assert.equal(response.headers.get("location"), path);
              for (const browserOrigin of ["https://test.example.com", "https://test.example.com:8443", "http://203.0.113.10:8884"]) {
                assert.equal(new URL(response.headers.get("location")!, browserOrigin).origin, browserOrigin);
              }
            }
          }
          assert.equal(languageRedirectLocation(request, "/posts", "?topic=tech"), "/zh/posts?topic=tech");
        }
      }
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) restoreEnv(key as keyof typeof saved, value);
  }
});

test("root-relative redirect helper rejects external authorities and preserves status/query/fragment", () => {
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/admin\r\nLocation: https://evil.test", "admin", "javascript:alert(1)"]) {
    assert.throws(() => redirectTo(value), /root-relative/);
  }
  assert.equal(redirectTo("/admin/posts?q=a%20b#draft", 307).headers.get("location"), "/admin/posts?q=a%20b#draft");
  assert.equal(redirectTo("/admin", 307).status, 307);
  assert.equal(redirectTo("/admin").status, 303);
  assert.equal(redirectTo("/admin", new Request("http://internal/"), 308).status, 308);
});


test("Next production proxy adapter emits relative redirects, never configured IPs", async () => {
  const previousMode = process.env.APP_MODE;
  const previousUrl = process.env.PUBLIC_URL;
  async function throughAdapter(path: string) {
    return (await adapter({
      page: "/proxy",
      request: { url: `http://127.0.0.1:8884${path}`, method: "GET", signal: new AbortController().signal, headers: { host: "test.example.com", "x-forwarded-proto": "https" } },
      handler: async request => proxy(request)
    })).response;
  }
  try {
    process.env.PUBLIC_URL = "http://203.0.113.10:8884";
    process.env.APP_MODE = "backend";
    for (const path of ["/", "/zh", "/posts", "/en/posts", "/community", "/account"]) {
      const response = await throughAdapter(path);
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "/admin");
    }
    process.env.APP_MODE = "full";
    assert.equal((await throughAdapter("/posts?topic=tech")).headers.get("location"), "/zh/posts?topic=tech");
    process.env.APP_MODE = "frontend";
    assert.equal((await throughAdapter("/admin/jobs")).headers.get("location"), "/admin");
  } finally {
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    restoreEnv("PUBLIC_URL", previousUrl);
  }
});
