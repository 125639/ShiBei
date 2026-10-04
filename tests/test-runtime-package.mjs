import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
  includeBuildFile,
  matchesPlatform,
  nativePackageNeeded,
  prismaEngineNeeded
} from "../scripts/runtime/layout.mjs";
import { packageRuntime } from "../scripts/package-runtime.mjs";

const linux = { platform: "linux", arch: "x64", libc: "glibc" };

test("production copies omit all environment-bound caches but retain compiled routes and assets", () => {
  for (const file of [
    "cache/webpack/client-production/0.pack",
    "cache/swc/plugins/foo",
    "cache/.tsbuildinfo",
    "types/routes.d.ts",
    "dev/server/app.js",
    "trace-build",
    "analyze/report.json",
    "cache/fetch-cache/tag",
    "cache/images/hash/image.webp",
    "cache/.rscinfo"
  ])
    assert.equal(includeBuildFile(file), false, file);
  for (const file of [
    "BUILD_ID",
    "server/app/page.html",
    "server/app/page.js",
    "static/chunks/chunk.js",
    "routes-manifest.json"
  ])
    assert.equal(includeBuildFile(file), true, file);
});

test("retaining data caches is an explicit policy, never confused with compiler caches", () => {
  assert.ok(includeBuildFile("cache/fetch-cache/tag", { includeDataCache: true }));
  assert.ok(includeBuildFile("cache/images/hash/image.webp", { includeDataCache: true }));
  assert.equal(includeBuildFile("cache/webpack/server/0.pack", { includeDataCache: true }), false);
});

test("native pruning follows OS, CPU and libc instead of hardcoding x64 filenames", () => {
  assert.ok(nativePackageNeeded({}, linux));
  assert.ok(nativePackageNeeded({ os: ["linux"], cpu: ["x64"], libc: ["glibc"] }, linux));
  assert.equal(nativePackageNeeded({ os: ["linux"], cpu: ["x64"], libc: ["musl"] }, linux), false);
  assert.equal(nativePackageNeeded({ os: ["linux"], cpu: ["arm64"] }, linux), false);
  assert.equal(nativePackageNeeded({ os: ["win32"] }, linux), false);
  assert.ok(matchesPlatform(["!win32"], "linux"));
  assert.equal(matchesPlatform(["!linux"], "linux"), false);
  assert.ok(matchesPlatform(["any"], "darwin"));
});

test("only unused Prisma binaries are removed; the native engine, JS and schema remain", () => {
  const target = "debian-openssl-3.0.x";
  assert.ok(prismaEngineNeeded(`libquery_engine-${target}.so.node`, target));
  assert.ok(prismaEngineNeeded(`schema-engine-${target}`, target));
  assert.equal(prismaEngineNeeded("libquery_engine-linux-musl-openssl-3.0.x.so.node", target), false);
  assert.ok(prismaEngineNeeded("query-engine-wasm.js", target));
  assert.ok(prismaEngineNeeded("schema.prisma", target));
  assert.equal(prismaEngineNeeded("libquery_engine-darwin-arm64.dylib.node", "darwin"), false);
  assert.ok(prismaEngineNeeded("query_engine-windows.dll.node", "windows"));
  assert.ok(prismaEngineNeeded("libquery_engine-other.so.node", null));
});

test("packager refuses destructive destinations or a missing build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-package-guard-"));
  try {
    await mkdir(path.join(root, "existing"));
    await writeFile(path.join(root, "existing/keep"), "user data");
    await assert.rejects(packageRuntime({ projectDir: root, outDir: root }), /ancestor/);
    await assert.rejects(packageRuntime({ projectDir: root, outDir: path.dirname(root) }), /ancestor/);
    await assert.rejects(packageRuntime({ projectDir: root, outDir: "node_modules/runtime" }), /Unsafe/);
    await assert.rejects(packageRuntime({ projectDir: root, outDir: "existing" }), /already exists/);
    await assert.rejects(packageRuntime({ projectDir: root, outDir: "release" }), /No production build/);
    assert.equal(await readFile(path.join(root, "existing/keep"), "utf8"), "user data");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Docker builders use a shared runtime packager and full/backends install only headless Chromium", async () => {
  for (const filename of ["Dockerfile", "Dockerfile.backend", "Dockerfile.frontend"]) {
    const dockerfile = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.match(dockerfile, /package-runtime\.mjs --out \/runtime --reuse-installed/);
    assert.match(dockerfile, /COPY --from=builder \/runtime\/\.next/);
    if (filename !== "Dockerfile.frontend") {
      assert.match(dockerfile, /FROM node:22-bookworm-slim AS runner/);
      assert.match(dockerfile, /install --with-deps --only-shell chromium/);
    }
  }
  const ignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  assert.match(ignore, /^\.next-\*$/m);
  assert.match(ignore, /^dist$/m);
});

test("browser-only editors stay build dependencies and preview-only parsers stay lazy", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["@tiptap/react", "@dnd-kit/core", "tiptap-markdown"]) {
    assert.ok(pkg.devDependencies[name]);
    assert.equal(pkg.dependencies[name], undefined);
  }
  assert.equal(pkg.dependencies["@fontsource-variable/noto-sans-sc"], undefined);
  for (const file of ["src/components/PostEditAssist.tsx", "src/components/writing/WritingStudio.tsx"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /import \{ markdownToHtml \}/);
    assert.match(source, /useMarkdownHtml/);
  }
  const writing = await readFile(
    new URL("../src/components/writing/WritingStudio.tsx", import.meta.url),
    "utf8"
  );
  assert.match(writing, /writingView === "preview" \|\| active\?\.creativeWorkId/);
});
