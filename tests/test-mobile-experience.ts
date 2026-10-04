import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { chartLabelIndexes } from "../src/lib/chart-layout";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("chart labels stay readable at phone widths and always retain first and last dates", () => {
  for (const count of [1, 2, 14, 24, 31]) {
    for (const width of [240, 288, 320, 390, 600, 1200]) {
      const labels = [...chartLabelIndexes(count, width)];
      assert.equal(labels[0], 0);
      assert.equal(labels.at(-1), count - 1);
      assert.equal(labels.length, new Set(labels).size);
      assert.ok(labels.length <= count);
      if (width <= 320) assert.ok(labels.length <= 4);
    }
  }
});

test("dense label requests don't cram desktop labels into a narrow chart", () => {
  assert.equal(chartLabelIndexes(24, 600, true).size, 24);
  assert.ok(chartLabelIndexes(24, 280, true).size < 6);
  assert.equal(chartLabelIndexes(0, 320).size, 0);
  assert.equal(chartLabelIndexes(24, NaN).size, 0);
});

test("mobile overlays escape header containing blocks and synchronize visual viewport", () => {
  const appearance = source("src/components/AppearancePanel.tsx");
  assert.match(appearance, /<dialog[^>]*appearance-dialog/);
  assert.match(appearance, /aria-haspopup="dialog"/);
  assert.match(source("src/components/mobile/useResponsiveDialog.ts"), /dialog.showModal\(\)/);
  const viewport = source("src/components/mobile/MobileViewport.tsx");
  assert.match(viewport, /window.visualViewport/);
  assert.match(viewport, /Math.abs\(viewport.scale - 1\)/);
  assert.match(viewport, /removeEventListener\("resize", schedule\)/);
});

test("assistant does not submit mobile Return keys or incomplete IME input", () => {
  const assistant = source("src/components/AiAssistant.tsx");
  assert.match(assistant, /nativeEvent.isComposing/);
  assert.match(assistant, /keyCode === 229/);
  assert.match(assistant, /pointer: coarse/);
  assert.match(assistant, /enterKeyHint="enter"/);
});

test("charts offer touch-accessible values instead of relying on hover titles", () => {
  const charts = source("src/components/Charts.tsx");
  assert.match(charts, /new ResizeObserver/);
  assert.match(charts, /<details className="chart-data"/);
  assert.match(charts, /<th scope="row">/);
  assert.match(charts, /chartLabelIndexes\(buckets.length, width/);
});
