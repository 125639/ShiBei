import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertSafeFetchUrl, safeFetch } from "../src/lib/url-safety";

describe("url safety", () => {
  test("rejects private IP literals before fetch", () => {
    assert.throws(() => assertSafeFetchUrl("http://127.0.0.1:6379/"), /不允许|内网/);
    assert.throws(() => assertSafeFetchUrl("http://169.254.169.254/latest/meta-data"), /内网|保留/);
    assert.throws(() => assertSafeFetchUrl("http://[::ffff:7f00:1]/"), /内网|保留/);
    assert.throws(() => assertSafeFetchUrl("http://[::ffff:a9fe:a9fe]/"), /内网|保留/);
  });

  test("rejects carrier NAT, metadata, benchmark, documentation and reserved ranges", () => {
    const blocked = [
      "http://100.64.0.1/",
      "http://100.100.100.200/latest/meta-data/",
      "http://100.127.255.254/",
      "http://192.0.0.1/",
      "http://192.0.2.10/",
      "http://192.88.99.1/",
      "http://198.18.0.1/",
      "http://198.19.255.254/",
      "http://198.51.100.20/",
      "http://203.0.113.30/",
      "http://[::ffff:6464:64c8]/",
      "http://[febf::1]/",
      "http://[fec0::1]/",
      "http://[ff02::1]/",
      "http://[2001:2::1]/",
      "http://[2001:10::1]/",
      "http://[2001:db8::1]/",
      "http://[2002:0808:0808::1]/",
      "http://[3fff::1]/"
    ];
    for (const url of blocked) {
      assert.throws(() => assertSafeFetchUrl(url), /内网|保留|公网/, url);
    }
    assert.doesNotThrow(() => assertSafeFetchUrl("https://1.1.1.1/public"));
    assert.doesNotThrow(() => assertSafeFetchUrl("https://8.8.8.8/public"));
    assert.doesNotThrow(() => assertSafeFetchUrl("https://[2606:4700:4700::1111]/public"));
  });

  test("validates redirect targets before following them", async () => {
    let calls = 0;
    await assert.rejects(
      safeFetch(
        "https://1.1.1.1/start",
        {},
        {
          fetcher: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://127.0.0.1/private" }
            });
          }
        }
      ),
      /内网|不允许/
    );
    assert.equal(calls, 1);
  });

  test("does not follow redirects into cloud metadata carrier-NAT space", async () => {
    let calls = 0;
    await assert.rejects(
      safeFetch(
        "https://1.1.1.1/start",
        {},
        {
          fetcher: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://100.100.100.200/latest/meta-data/" }
            });
          }
        }
      ),
      /内网|保留/
    );
    assert.equal(calls, 1);
  });

  test("does not follow redirects into non-public IPv6 space", async () => {
    let calls = 0;
    await assert.rejects(
      safeFetch(
        "https://1.1.1.1/start",
        {},
        {
          fetcher: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://[fec0::1]/internal" }
            });
          }
        }
      ),
      /公网|保留/
    );
    assert.equal(calls, 1);
  });
});
