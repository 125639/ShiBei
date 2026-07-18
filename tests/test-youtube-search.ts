import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractSalientTokens,
  parseYouTubeSearchResults,
  pickTopRelevantVideo,
  type YouTubeSearchResult
} from "../src/lib/youtube-search";

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

  test("filters out Shorts by duration but keeps unknown durations", () => {
    const out = parseYouTubeSearchResults(
      fixture([
        { id: "aaaaaaaaaaa", title: "short 45s", view_count: 9_000_000, duration: 45 },
        { id: "bbbbbbbbbbb", title: "full 300s", view_count: 100, duration: 300 },
        { id: "ccccccccccc", title: "no duration", view_count: 50 },
      ]),
      10
    );
    assert.deepEqual(out.map((r) => r.title), ["full 300s", "no duration"]);
  });
});

describe("extractSalientTokens", () => {
  test("pulls model-like tokens from mixed CJK/ASCII titles", () => {
    assert.deepEqual(extractSalientTokens("小鹏L03慕尼黑首发：以“物理AI”切入全球大众市场"), ["L03"]);
    assert.deepEqual(extractSalientTokens("开了3000公里的小米SU7 Ultra 与 Mate70 Pro+"), ["SU7", "MATE70"]);
  });

  test("ignores pure numbers, years, and plain words; dedupes; caps at 4", () => {
    assert.deepEqual(extractSalientTokens("2027 年新能源展望，与 9020 无关"), []);
    assert.deepEqual(extractSalientTokens("SU7 su7 P7+ M9x K50 G6 extra A1 B2"), ["SU7", "P7+", "M9X", "K50"]);
  });
});

describe("pickTopRelevantVideo", () => {
  const mk = (title: string, viewCount: number): YouTubeSearchResult => ({
    watchUrl: `https://www.youtube.com/watch?v=${title.replace(/\W/g, "").padEnd(11, "x").slice(0, 11)}`,
    title,
    viewCount,
    durationSec: 300,
    channel: null
  });

  test("prefers a lower-view candidate whose title hits a salient token (L03 case)", () => {
    const results = [mk("XPENG小鹏P7+，汽车年度卷王来了", 990_000), mk("小鹏L03慕尼黑实拍", 12_000)];
    const pick = pickTopRelevantVideo(results, ["L03"]);
    assert.equal(pick?.title, "小鹏L03慕尼黑实拍");
  });

  test("falls back to view ranking when no candidate hits and when no tokens", () => {
    const results = [mk("hot but unrelated", 990_000), mk("also unrelated", 12_000)];
    assert.equal(pickTopRelevantVideo(results, ["L03"])?.title, "hot but unrelated");
    assert.equal(pickTopRelevantVideo(results, [])?.title, "hot but unrelated");
    assert.equal(pickTopRelevantVideo([], ["L03"]), null);
  });
});
