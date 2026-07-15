/**
 * Read-only production hydration diagnostic.
 *
 * The document response is never intercepted, so Next/React streaming timing is
 * preserved. Only the shared React DOM client chunk is intercepted and patched
 * with a synchronous snapshot immediately before React throws hydration #418.
 * Public APIs are fulfilled in Playwright so the run creates no application data.
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
if (!BASE) throw new Error("BASE_URL is required");
const ROUNDS = Number.parseInt(process.env.ROUNDS || "240", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "4", 10);
const DWELL_MS = Number.parseInt(process.env.DWELL_MS || "750", 10);
const REACT_CHUNK = "**/_next/static/chunks/4bd1b696-f785427dddbba9fb.js";
const RUNTIME_PREFIX = "function rD(e){var n=Error";
const LOG_PREFIX = "__SHIBEI_HYDRATION_FIBER__";

const diagnostics = [];
const pageErrors = [];
const browser = await chromium.launch({ headless: true });
let nextRound = 0;
let hydrations = 0;
let chunkPatches = 0;

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, worker) => runWorker(worker)));
} finally {
  await browser.close();
}

const artifactDir = `/tmp/shibei-hydration-residual-${Date.now()}`;
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(`${artifactDir}/evidence.json`, JSON.stringify({
  base: BASE,
  rounds: ROUNDS,
  concurrency: CONCURRENCY,
  dwellMs: DWELL_MS,
  hydrations,
  chunkPatches,
  diagnostics,
  pageErrors
}, null, 2));

console.log(JSON.stringify({
  artifactDir,
  hydrations,
  chunkPatches,
  diagnosticCount: diagnostics.length,
  pageErrorCount: pageErrors.length,
  diagnostics,
  pageErrors
}, null, 2));

if (diagnostics.length === 0) process.exitCode = 2;

async function runWorker(worker) {
  while (diagnostics.length === 0) {
    const round = nextRound;
    nextRound += 1;
    if (round >= ROUNDS) return;

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 }
    });
    await context.route(REACT_CHUNK, patchReactChunk);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    let phase = "initial";

    page.on("console", (message) => {
      const text = message.text();
      if (!text.startsWith(LOG_PREFIX)) return;
      try {
        diagnostics.push({ worker, round, phase, url: page.url(), ...JSON.parse(text.slice(LOG_PREFIX.length)) });
      } catch (error) {
        diagnostics.push({ worker, round, phase, url: page.url(), parseError: String(error), raw: text });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ worker, round, phase, url: page.url(), message: error.message, stack: error.stack });
    });

    await installApiFixtures(page, round);
    try {
      for (let index = 0; index < 4 && diagnostics.length === 0; index += 1) {
        phase = index === 0 ? "goto" : `reload-${index}`;
        if (index === 0) {
          await page.goto(`${BASE}/write?mode=manual`, { waitUntil: "domcontentloaded" });
        } else {
          await page.reload({ waitUntil: "domcontentloaded" });
        }
        hydrations += 1;
        await page.waitForFunction(() =>
          document.querySelector(".notion-editor .tiptap")?.getAttribute("contenteditable") === "true"
        );
        await page.waitForTimeout(DWELL_MS);
      }
    } finally {
      await context.close();
    }
  }
}

async function patchReactChunk(route) {
  const response = await route.fetch();
  const original = await response.text();
  const occurrences = original.split(RUNTIME_PREFIX).length - 1;
  if (occurrences !== 1) {
    throw new Error(`React hydration hook prefix count was ${occurrences}, expected 1`);
  }

  const injected = `function rD(e){try{\nvar __db=function(x){if(!x)return null;return{nodeType:x.nodeType,nodeName:x.nodeName||null,tagName:x.tagName||null,id:x.id||null,className:"string"==typeof x.className?x.className:null,data:"string"==typeof x.data?x.data:null,outerHTML:"string"==typeof x.outerHTML?x.outerHTML.slice(0,600):null}},\n__dom=function(x){if(!x)return null;var b=__db(x);b.parent=__db(x.parentNode);b.previousSibling=__db(x.previousSibling);b.nextSibling=__db(x.nextSibling);return b},\n__type=function(x){if("string"==typeof x)return x;if("function"==typeof x)return x.displayName||x.name||"function";if(x&&"object"==typeof x)return x.displayName||x.name||x.$$typeof&&String(x.$$typeof)||x.constructor&&x.constructor.name||"object";return null},\n__child=function(x){if(null==x||"string"==typeof x||"number"==typeof x||"boolean"==typeof x)return x;if(Array.isArray(x))return"Array("+x.length+")";if(x&&"object"==typeof x&&x.$$typeof)return{reactType:__type(x.type),key:x.key||null};return typeof x},\n__props=function(x){if(!x||"object"!=typeof x)return x;var o={},ks=["id","className","hidden","tabIndex","role","href","lang","aria-busy","aria-hidden","aria-label"];for(var j=0;j<ks.length;j++){var k=ks[j];void 0!==x[k]&&(o[k]=x[k])}void 0!==x.children&&(o.children=Array.isArray(x.children)?x.children.slice(0,8).map(__child):__child(x.children));return o},\n__state=function(x){if(!x)return null;if(x.nodeType)return __db(x);return{kind:x.constructor&&x.constructor.name||typeof x,keys:"object"==typeof x?Object.keys(x).slice(0,20):[]}},\n__chain=function(x){for(var a=[],j=0;x&&j<16;j++,x=x.return)a.push({tag:x.tag,key:x.key||null,type:__type(x.type),elementType:__type(x.elementType),pendingProps:__props(x.pendingProps),memoizedProps:__props(x.memoizedProps),stateNode:__state(x.stateNode)});return a},\n__out={at:Date.now(),perf:"undefined"!=typeof performance?performance.now():null,readyState:"undefined"!=typeof document?document.readyState:null,argText:1<arguments.length&&void 0!==arguments[1]&&arguments[1],hydrating:rL,singletonContext:r_,pointer:__dom(rN),fiberChain:__chain(e),hydrationParentChain:__chain(rP)};\nconsole.error("${LOG_PREFIX}"+JSON.stringify(__out))}catch(__diagError){console.error("${LOG_PREFIX}"+JSON.stringify({instrumentationError:String(__diagError)}))}var n=Error`;

  chunkPatches += 1;
  await route.fulfill({ response, body: original.replace(RUNTIME_PREFIX, injected) });
}

async function installApiFixtures(page, round) {
  const updatedAt = new Date(Date.UTC(2026, 6, 13, 12, 0, round % 60)).toISOString();
  const doc = {
    id: `hydration-fiber-doc-${round}`,
    title: `残余水合诊断 ${round}`,
    content: "短正文。",
    completedAt: null,
    creativeWorkId: null,
    publicationBlockedAt: null,
    updatedAt
  };

  await page.route("**/api/public/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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
