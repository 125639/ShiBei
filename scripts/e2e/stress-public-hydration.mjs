/**
 * Diagnostic-only production hydration stress test.
 *
 * It keeps every private/public API response inside Playwright so the run does
 * not create or mutate application data. UA_MODE=bot asks Next.js to block on
 * metadata instead of streaming it; comparing that with UA_MODE=normal helps
 * isolate metadata-boundary races.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
if (!BASE) throw new Error("BASE_URL is required");
const ROUNDS = Number.parseInt(process.env.ROUNDS || "24", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "3", 10);
const UA_MODE = process.env.UA_MODE || "normal";
const TARGET_PATH = process.env.TARGET_PATH || "/write?mode=manual";
const READY_SELECTOR = process.env.READY_SELECTOR || ".notion-editor .tiptap";
const DOCUMENT_DIAGNOSTICS = process.env.DOCUMENT_DIAGNOSTICS === "1";
const SETTLE_MS = Number.parseInt(process.env.SETTLE_MS || "0", 10);
const userAgent = UA_MODE === "bot"
  ? "facebookexternalhit/1.1 (+https://www.facebook.com/externalhit_uatext.php)"
  : undefined;

const browser = await chromium.launch({ headless: true });
let hydrations = 0;
const errors = [];
const documentReports = [];
const loadedDocuments = [];

try {
  let nextRound = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const round = nextRound;
      nextRound += 1;
      if (round >= ROUNDS) return;

      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        ...(userAgent ? { userAgent } : {})
      });
      if (DOCUMENT_DIAGNOSTICS) {
        await context.addInitScript(() => {
          const documentId = `${performance.timeOrigin}-${Math.random().toString(36).slice(2)}`;
          globalThis.__shibeiHydrationDocumentId = documentId;
          window.addEventListener("error", (event) => {
            const message = event.error?.message || event.message || "";
            if (!message.includes("Minified React error #418")) return;
            console.error(`[SHIBEI_HYDRATION_DOCUMENT]${JSON.stringify({
              documentId,
              timeOrigin: performance.timeOrigin,
              now: performance.now(),
              href: location.href,
              readyState: document.readyState,
              visibilityState: document.visibilityState,
              message
            })}`);
          }, true);
        });
      }
      const page = await context.newPage();
      let phase = "initial";
      page.on("pageerror", (error) => {
        errors.push({ round, phase, url: page.url(), message: error.message });
      });
      if (DOCUMENT_DIAGNOSTICS) {
        page.on("console", (message) => {
          const text = message.text();
          const prefix = "[SHIBEI_HYDRATION_DOCUMENT]";
          if (!text.startsWith(prefix)) return;
          try {
            documentReports.push({ round, phase, ...JSON.parse(text.slice(prefix.length)) });
          } catch {
            documentReports.push({ round, phase, parseError: text });
          }
        });
      }
      await installApiFixtures(page, round);

      try {
        for (let index = 0; index < 4; index += 1) {
          phase = index === 0 ? "goto" : `reload-${index}`;
          if (index === 0) {
            await page.goto(`${BASE}${TARGET_PATH}`, { waitUntil: "domcontentloaded" });
          } else {
            await page.reload({ waitUntil: "domcontentloaded" });
          }
          hydrations += 1;
          await page.waitForFunction((selector) => {
            const element = document.querySelector(selector);
            if (!element) return false;
            if (selector === ".notion-editor .tiptap") {
              return element.getAttribute("contenteditable") === "true";
            }
            return true;
          }, READY_SELECTOR);
          await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }));
          if (DOCUMENT_DIAGNOSTICS) {
            loadedDocuments.push(await page.evaluate(({ round, phase }) => ({
              round,
              phase,
              documentId: globalThis.__shibeiHydrationDocumentId,
              timeOrigin: performance.timeOrigin,
              now: performance.now(),
              readyState: document.readyState
            }), { round, phase }));
          }
          if (SETTLE_MS > 0) await page.waitForTimeout(SETTLE_MS);
        }
      } finally {
        await context.close();
      }
    }
  }));
} finally {
  await browser.close();
}

const hydrationErrors = errors.filter((item) => item.message.includes("Minified React error #418"));
console.log(JSON.stringify({
  uaMode: UA_MODE,
  targetPath: TARGET_PATH,
  rounds: ROUNDS,
  hydrations,
  pageErrors: errors.length,
  hydrationErrors: hydrationErrors.length,
  errors,
  ...(DOCUMENT_DIAGNOSTICS ? { loadedDocuments, documentReports } : {})
}, null, 2));

if (errors.length > 0) process.exitCode = 1;

async function installApiFixtures(page, round) {
  const updatedAt = new Date(Date.UTC(2026, 6, 13, 12, 0, round)).toISOString();
  const doc = {
    id: `hydration-doc-${round}`,
    title: `水合压力文档 ${round}`,
    content: "短正文。",
    completedAt: null,
    creativeWorkId: null,
    publicationBlockedAt: null,
    updatedAt
  };

  await page.route("**/api/public/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/public/anon/bootstrap") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    if (path === "/api/public/writing/docs") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: [withoutContent(doc)], nextCursor: null, hasMore: false })
      });
    }
    if (path === "/api/public/creation/works") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          works: [],
          nextCursor: null,
          hasMore: false,
          isMember: false,
          anonQuotaRemaining: 2,
          anonWorkLimit: 2
        })
      });
    }
    if (path === `/api/public/writing/docs/${doc.id}`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc }) });
    }
    if (path === "/api/public/creation/genres") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          genres: [{ id: "hydration-genre", slug: "hydration", name: "测试", description: "", dimensions: [], threshold: 70 }],
          depths: {
            SHORT: { label: "快速成文", description: "快速评分" },
            FULL: { label: "深度成文", description: "深度评分" }
          },
          modes: {}
        })
      });
    }
    if (path === "/api/public/music") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tracks: [] }) });
    }
    if (path === "/api/public/visit") return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

function withoutContent(value) {
  return {
    id: value.id,
    title: value.title,
    completedAt: value.completedAt,
    creativeWorkId: value.creativeWorkId,
    publicationBlockedAt: value.publicationBlockedAt,
    updatedAt: value.updatedAt
  };
}
