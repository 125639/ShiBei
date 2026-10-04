#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { directoryBytes } from "./package-runtime.mjs";
import { includeBuildFile } from "./runtime/layout.mjs";

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const build = path.resolve(value("--build-dir", process.env.SHIBEI_DIST_DIR || ".next"));
const size = (directory) => directoryBytes(directory).catch(() => 0);
const mebibytes = (bytes) => +(bytes / 1048576).toFixed(2);
let productionBytes = 0;
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (!includeBuildFile(path.relative(build, file))) continue;
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) productionBytes += (await fs.stat(file)).size;
  }
}
await walk(build);
const result = {
  build: { totalMiB: mebibytes(await size(build)), productionFilesMiB: mebibytes(productionBytes) },
  installedDependenciesMiB: mebibytes(await size("node_modules")),
  publicMiB: mebibytes(await size("public"))
};
const url = value("--url", null);
if (url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Page request failed: ${response.status}`);
  const html = await response.text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1])
    )
  ];
  let bytes = 0,
    gzipBytes = 0;
  for (const asset of assets) {
    const result = await fetch(new URL(asset, url));
    if (!result.ok) throw new Error(`Asset request failed: ${result.status}`);
    const buffer = Buffer.from(await result.arrayBuffer());
    bytes += buffer.length;
    gzipBytes += gzipSync(buffer).length;
  }
  result.page = {
    url,
    assets: assets.length,
    rawKiB: +(bytes / 1024).toFixed(1),
    gzipKiB: +(gzipBytes / 1024).toFixed(1),
    note: "HTML-referenced JS/CSS including the legacy nomodule bundle; excludes dynamic loads and images."
  };
}
console.log(JSON.stringify(result, null, 2));
