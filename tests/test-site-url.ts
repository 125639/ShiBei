import assert from "node:assert/strict";
import test from "node:test";
import { redirectTo } from "../src/lib/redirect";
import {
  absoluteSiteUrl,
  configuredSiteOrigin,
  requestSiteOrigin,
  siteOrigin
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

test("configured PUBLIC_URL cannot be replaced by forwarded headers", () => {
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousLegacyUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.PUBLIC_URL = "https://canonical.example.test";
    delete mutableEnv.NEXT_PUBLIC_SITE_URL;
    const request = new Request("http://internal:3000/api/admin/login", {
      headers: {
        "X-Forwarded-Host": "attacker.example.test",
        "X-Forwarded-Proto": "http"
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
  }
});
