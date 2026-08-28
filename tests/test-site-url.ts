import assert from "node:assert/strict";
import test from "node:test";
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
      "http://203.0.113.10:3000/admin"
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
      "https://canonical.example.test/admin"
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
      "https://blog.example.test/admin"
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
      "https://blog.example.test:8443/admin"
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
