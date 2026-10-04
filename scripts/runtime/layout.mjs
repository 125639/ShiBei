import path from "node:path";

export const BUILD_ONLY_CACHE = new Set(["webpack", "swc", ".tsbuildinfo"]);

/** Keep ISR/fetch/image caches distinct from the compiler cache. Never apply
 * this filter to a live directory: it is used while copying a new release.
 */
export function includeBuildFile(relative, { includeDataCache = false } = {}) {
  const parts = relative.replaceAll(path.sep, "/").split("/");
  if (!relative) return true;
  if (["types", "dev", "diagnostics", "standalone", "analyze"].includes(parts[0])) return false;
  if (["trace", "trace-build", "build-diagnostics.json"].includes(parts[0])) return false;
  if (parts[0] === "cache" && (!includeDataCache || BUILD_ONLY_CACHE.has(parts[1]))) return false;
  return true;
}

export function matchesPlatform(values, current) {
  if (!Array.isArray(values) || !values.length || !current) return true;
  if (values.includes(`!${current}`)) return false;
  const allowed = values.filter((value) => !value.startsWith("!"));
  return !allowed.length || allowed.includes(current) || allowed.includes("any");
}

export function nativePackageNeeded(pkg, { platform, arch, libc }) {
  return (
    matchesPlatform(pkg.os, platform) && matchesPlatform(pkg.cpu, arch) && matchesPlatform(pkg.libc, libc)
  );
}

export function isPrismaEngine(file) {
  return (
    /^(?:libquery_engine-|query_engine-|query-engine-|schema-engine-)/.test(file) && !file.endsWith(".js")
  );
}

export function prismaEngineNeeded(file, target) {
  if (!target || !isPrismaEngine(file)) return true;
  const name = file.replace(/^(?:libquery_engine-|query_engine-|query-engine-|schema-engine-)/, "");
  return name === target || name.startsWith(`${target}.`);
}

export function nativeTarget() {
  return {
    platform: process.platform,
    arch: process.arch,
    libc:
      process.platform === "linux"
        ? process.report.getReport().header.glibcVersionRuntime
          ? "glibc"
          : "musl"
        : null
  };
}
