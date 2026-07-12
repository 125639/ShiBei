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
});
