#!/usr/bin/env node
/** Assemble a production-only distribution without mutating the checkout.
 * node scripts/package-runtime.mjs --out dist/runtime [--build-dir .next] [--reuse-installed]
 * A package is platform-specific and intentionally contains no .env or uploads.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  includeBuildFile,
  nativePackageNeeded,
  nativeTarget,
  prismaEngineNeeded
} from "./runtime/layout.mjs";

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}
export async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(file);
    else if (entry.isFile()) total += (await fs.stat(file)).size;
  }
  return total;
}
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal})`))
    );
  });
}

async function packageDirectories(modules) {
  const result = [];
  for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const child of await fs.readdir(path.join(modules, entry.name), { withFileTypes: true })) {
        if (child.isDirectory()) result.push(path.join(modules, entry.name, child.name));
      }
    } else result.push(path.join(modules, entry.name));
  }
  return result;
}

/** Only called on the newly created staging directory, never on the live app. */
async function trimRuntime(staging, prismaTarget, keepSourceMaps) {
  const removed = [];
  const platform = nativeTarget();
  const remove = async (file, reason) => {
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) return;
    const bytes = stat.isDirectory() ? await directoryBytes(file) : stat.size;
    await fs.rm(file, { recursive: true, force: true });
    removed.push({ path: path.relative(staging, file), reason, bytes });
  };
  const modules = path.join(staging, "node_modules");
  for (const directory of await packageDirectories(modules)) {
    const pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8").catch(() => "{}"));
    if (pkg.name?.startsWith("@next/swc-")) await remove(directory, "build-only compiler");
    else if (!nativePackageNeeded(pkg, platform)) await remove(directory, "different OS/CPU/libc");
  }
  for (const directory of [".prisma/client", "@prisma/engines"]) {
    const full = path.join(modules, directory);
    if (!(await exists(full))) continue;
    for (const name of await fs.readdir(full)) {
      if (!prismaEngineNeeded(name, prismaTarget))
        await remove(path.join(full, name), "different Prisma engine target");
    }
  }
  await remove(path.join(modules, "next/dist/docs"), "build/development reference documentation");
  if (!keepSourceMaps) {
    let maps = 0;
    let bytes = 0;
    async function visit(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && entry.name.endsWith(".map")) {
          bytes += (await fs.stat(file)).size;
          maps++;
          await fs.unlink(file);
        }
      }
    }
    await visit(modules);
    removed.push({
      path: "node_modules/**/*.map",
      reason: "optional dependency source maps (use --keep-source-maps to retain)",
      files: maps,
      bytes
    });
  }
  return removed;
}

export async function packageRuntime({
  projectDir,
  outDir,
  buildDir = ".next",
  reuseInstalled = false,
  keepSourceMaps = false
}) {
  const project = await fs.realpath(projectDir);
  const output = path.resolve(project, outDir);
  const build = path.resolve(project, buildDir);
  if (output === path.parse(output).root || project === output || project.startsWith(output + path.sep))
    throw new Error("Output cannot replace the project or an ancestor");
  for (const protectedPath of [
    build,
    path.join(project, "node_modules"),
    path.join(project, "src"),
    path.join(project, "public")
  ]) {
    if (output === protectedPath || output.startsWith(protectedPath + path.sep))
      throw new Error(`Unsafe output directory: ${output}`);
  }
  if (await exists(output))
    throw new Error(`Output already exists; choose a new release directory: ${output}`);
  if (!(await exists(path.join(build, "BUILD_ID"))))
    throw new Error(`No production build in ${build}; run npm run build first`);
  if (
    !(await exists(path.join(project, "next.config.mjs"))) ||
    (await exists(path.join(project, "next.config.ts")))
  )
    throw new Error(
      "Runtime pruning requires the JavaScript next.config.mjs; TypeScript configs need SWC at runtime"
    );
  if (!(await exists(path.join(project, "node_modules/.prisma/client/schema.prisma"))))
    throw new Error("Prisma client has not been generated");
  if (reuseInstalled) {
    if ((await fs.lstat(path.join(project, "node_modules"))).isSymbolicLink())
      throw new Error("--reuse-installed requires a private, non-symlinked production dependency directory");
    const pkg = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
    const installedLock = JSON.parse(
      await fs.readFile(path.join(project, "node_modules/.package-lock.json"), "utf8")
    );
    for (const name of Object.keys(pkg.devDependencies || {})) {
      if (
        installedLock.packages?.[`node_modules/${name}`]?.dev &&
        (await exists(path.join(project, "node_modules", name)))
      )
        throw new Error(
          `Development package ${name} is still installed; run npm prune --omit=dev in a disposable builder first`
        );
    }
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(output), ".shibei-runtime-"));
  try {
    // Allowlist: no environment files, databases, backups, browser caches or uploads.
    for (const name of ["package.json", "package-lock.json", "next.config.mjs", "tsconfig.json"]) {
      await fs.copyFile(path.join(project, name), path.join(staging, name));
    }
    for (const name of ["src", "prisma", "scripts"]) {
      await fs.cp(path.join(project, name), path.join(staging, name), {
        recursive: true,
        filter: (source) =>
          !source.startsWith(path.join(project, "scripts/e2e")) && !source.endsWith("/demo-db.ts")
      });
    }
    await fs.cp(path.join(project, "public"), path.join(staging, "public"), {
      recursive: true,
      filter: (source) =>
        source !== path.join(project, "public/uploads") &&
        !source.startsWith(path.join(project, "public/uploads") + path.sep)
    });
    await fs.cp(build, path.join(staging, ".next"), {
      recursive: true,
      filter: (source) => includeBuildFile(path.relative(build, source))
    });
    if (reuseInstalled) {
      await fs.cp(path.join(project, "node_modules"), path.join(staging, "node_modules"), {
        recursive: true,
        dereference: false
      });
    } else {
      await run(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["ci", "--omit=dev", "--no-audit", "--no-fund"],
        {
          cwd: staging,
          env: {
            ...process.env,
            PRISMA_SKIP_POSTINSTALL_GENERATE: "true",
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
            NODE_ENV: "production"
          }
        }
      );
      await fs.cp(path.join(project, "node_modules/.prisma"), path.join(staging, "node_modules/.prisma"), {
        recursive: true
      });
    }
    const requireFromProject = createRequire(path.join(project, "package.json"));
    const prismaTarget = await requireFromProject("@prisma/get-platform").getBinaryTargetForCurrentPlatform();
    const beforeTrimBytes = await directoryBytes(staging);
    const removed = await trimRuntime(staging, prismaTarget, keepSourceMaps);
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      buildId: (await fs.readFile(path.join(build, "BUILD_ID"), "utf8")).trim(),
      platform: nativeTarget(),
      prismaTarget,
      nodeMajor: Number(process.versions.node.split(".")[0]),
      sourceBuildBytes: await directoryBytes(build),
      runtimeBuildBytes: await directoryBytes(path.join(staging, ".next")),
      beforeTrimBytes,
      runtimeBytes: await directoryBytes(staging),
      removed,
      externalData: [
        ".env (or environment variables)",
        "public/uploads",
        "PostgreSQL",
        "Redis (full/backend)",
        "Playwright browser binaries (full/backend)"
      ],
      notes: [
        "Build tools stay in the source checkout; this release cannot build Next.js.",
        "Native packages target the current platform/libc. Repackage on the deployment platform.",
        "No authentication or uploaded-data paths are changed."
      ]
    };
    await fs.writeFile(path.join(staging, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // Fail before publishing if required engines or entrypoints were accidentally removed.
    await run(
      process.execPath,
      [
        "-e",
        `require('next'); require('@prisma/client'); require.resolve('tsx/cli'); console.log('Runtime dependencies resolved.');`
      ],
      {
        cwd: staging,
        env: { ...process.env, NODE_ENV: "production" }
      }
    );
    await fs.rename(staging, output);
    return manifest;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };
  try {
    const manifest = await packageRuntime({
      projectDir: process.cwd(),
      outDir: value("--out", "dist/runtime"),
      buildDir: value("--build-dir", process.env.SHIBEI_DIST_DIR || ".next"),
      reuseInstalled: args.includes("--reuse-installed"),
      keepSourceMaps: args.includes("--keep-source-maps")
    });
    console.log(
      JSON.stringify(
        {
          output: value("--out", "dist/runtime"),
          runtimeMiB: +(manifest.runtimeBytes / 1048576).toFixed(2),
          buildMiB: +(manifest.runtimeBuildBytes / 1048576).toFixed(2),
          removedMiB: +((manifest.beforeTrimBytes - manifest.runtimeBytes) / 1048576).toFixed(2),
          platform: manifest.platform
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`[package-runtime] ${error.message}`);
    process.exitCode = 1;
  }
}
