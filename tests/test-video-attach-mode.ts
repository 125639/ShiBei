import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeVideoAttachMode, resolveVideoAttachMode } from "../src/lib/video-attach-mode";

describe("normalizeVideoAttachMode", () => {
  test("accepts the four modes case-insensitively and trims", () => {
    assert.equal(normalizeVideoAttachMode("embed"), "embed");
    assert.equal(normalizeVideoAttachMode(" LINK "), "link");
    assert.equal(normalizeVideoAttachMode("Download"), "download");
    assert.equal(normalizeVideoAttachMode("off"), "off");
  });

  test("rejects everything else", () => {
    assert.equal(normalizeVideoAttachMode(""), null);
    assert.equal(normalizeVideoAttachMode(null), null);
    assert.equal(normalizeVideoAttachMode(undefined), null);
    assert.equal(normalizeVideoAttachMode("auto"), null);
    assert.equal(normalizeVideoAttachMode(42), null);
  });
});

describe("resolveVideoAttachMode", () => {
  test("job override wins over site default", () => {
    assert.equal(resolveVideoAttachMode("download", "embed"), "download");
    assert.equal(resolveVideoAttachMode("off", "download"), "off");
  });

  test("falls back to site default, then to embed", () => {
    assert.equal(resolveVideoAttachMode(null, "link"), "link");
    assert.equal(resolveVideoAttachMode(undefined, "download"), "download");
    assert.equal(resolveVideoAttachMode(null, null), "embed");
    assert.equal(resolveVideoAttachMode("bogus", "bogus"), "embed");
  });
});
