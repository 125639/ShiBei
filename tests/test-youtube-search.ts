import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseYouTubeSearchResults } from "../src/lib/youtube-search";

function fixture(entries: unknown[]) {
  return JSON.stringify({ entries });
}

describe("parseYouTubeSearchResults", () => {
  test("ranks by view_count descending and honours the limit", () => {
    const out = parseYouTubeSearchResults(
      fixture([
        { id: "aaaaaaaaaaa", title: "low", view_count: 100 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "high", view_count: 999999, duration: 600, uploader: "Chan" },
        { id: "ccccccccccc", title: "mid", view_count: 5000 },
      ]),
      2
    );
    assert.deepEqual(out.map((r) => r.title), ["high", "mid"]);
    assert.equal(out[0].viewCount, 999999);
    assert.equal(out[0].watchUrl, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
    assert.equal(out[0].durationSec, 600);
    assert.equal(out[0].channel, "Chan");
  });

  test("drops duplicates and anything that is not a standard watch page", () => {
    const out = parseYouTubeSearchResults(
      fixture([
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "keep", view_count: 10 },
        { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "dupe", view_count: 9_000_000 },
        { url: "https://www.youtube.com/@somechannel", title: "channel", view_count: 9_000_000 },
        { url: "https://www.youtube.com/playlist?list=PLxyz", title: "playlist", view_count: 9_000_000 },
        { url: "https://example.com/watch?v=zzz", title: "not youtube", view_count: 9_000_000 },
      ]),
      10
    );
    assert.deepEqual(out.map((r) => r.title), ["keep"]);
  });

  test("normalizes youtu.be and /shorts/ and missing fields", () => {
    const out = parseYouTubeSearchResults(
      fixture([
        { url: "https://youtu.be/ddddddddddd", title: "short link", view_count: "1200" },
        { url: "https://www.youtube.com/shorts/eeeeeeeeeee", view_count: null },
      ]),
      10
    );
    assert.equal(out.length, 2);
    const byUrl = Object.fromEntries(out.map((r) => [r.watchUrl, r]));
    assert.ok(byUrl["https://www.youtube.com/watch?v=ddddddddddd"]);
    assert.equal(byUrl["https://www.youtube.com/watch?v=ddddddddddd"].viewCount, 1200);
    const shorts = byUrl["https://www.youtube.com/watch?v=eeeeeeeeeee"];
    assert.ok(shorts);
    assert.equal(shorts.viewCount, 0);
    assert.equal(shorts.title, "");
    assert.equal(shorts.durationSec, null);
  });

  test("returns [] for malformed or empty input", () => {
    assert.deepEqual(parseYouTubeSearchResults("not json", 5), []);
    assert.deepEqual(parseYouTubeSearchResults(JSON.stringify({}), 5), []);
    assert.deepEqual(parseYouTubeSearchResults(JSON.stringify({ entries: "x" }), 5), []);
    assert.deepEqual(parseYouTubeSearchResults(fixture([]), 5), []);
  });
});
