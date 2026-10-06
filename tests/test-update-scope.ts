import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangeScope, isInertUpdatePath, UPDATE_SCOPE_MAX_FILES } from "../src/lib/update-scope";

test("文档 / 测试 / CI 路径不进入运行镜像", () => {
  const inert = [
    "README.md",
    "SYNC.md",
    "DEPLOY_NOTES.md",
    "docs/public-ui.md",
    "docs/nested/deep.md",
    "tests/test-update-scope.ts",
    ".github/workflows/ci.yml"
  ];
  for (const path of inert) {
    assert.equal(isInertUpdatePath(path), true, `${path} 应视为不影响镜像`);
  }
});

test("运行期路径必须触发更新提示", () => {
  const affecting = [
    "src/lib/update.ts",
    "src/lib/update-scope.ts",
    "src/app/globals.css",
    "prisma/schema.prisma",
    "prisma/migrations/20261004160000_remove_learning/migration.sql",
    "scripts/updater/server.mjs",
    "scripts/start-app.sh",
    "Dockerfile",
    "Dockerfile.updater",
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "tsconfig.json",
    "docker-compose.yml",
    ".dockerignore",
    ".gitignore",
    "public/robots.txt",
    "docs/../src/proxy.ts"
  ];
  for (const path of affecting) {
    assert.equal(isInertUpdatePath(path), false, `${path} 应按影响镜像处理`);
  }
});

test("只有整批变更都是文档类才算 docsOnly", () => {
  assert.equal(classifyChangeScope(["README.md", "docs/a.md", ".github/workflows/ci.yml"]).docsOnly, true);
  assert.equal(classifyChangeScope(["README.md", "src/proxy.ts"]).docsOnly, false);
  assert.equal(classifyChangeScope(["src/lib/update.ts"]).docsOnly, false);
});

test("拿不到文件列表时保守处理（宁可提示也不要漏掉真实更新）", () => {
  assert.equal(classifyChangeScope([]).docsOnly, false, "空列表");
  assert.equal(classifyChangeScope(undefined).docsOnly, false, "undefined");
  assert.equal(classifyChangeScope(null).docsOnly, false, "null");
  assert.equal(classifyChangeScope("README.md").docsOnly, false, "非数组");
  assert.equal(classifyChangeScope([""]).docsOnly, false, "只有空字符串");
  assert.equal(classifyChangeScope([123, "README.md"]).docsOnly, true, "非字符串项被丢弃");
});

test("列表可能被截断时不做 docsOnly 判定", () => {
  assert.equal(classifyChangeScope(["README.md"], true).truncated, true);
  assert.equal(classifyChangeScope(["README.md"], true).docsOnly, false);
  assert.equal(classifyChangeScope(Array(UPDATE_SCOPE_MAX_FILES).fill("docs/a.md")).truncated, true);
  assert.equal(classifyChangeScope(Array(UPDATE_SCOPE_MAX_FILES).fill("docs/a.md")).docsOnly, false);
  assert.equal(
    classifyChangeScope(Array(UPDATE_SCOPE_MAX_FILES - 1).fill("docs/a.md")).docsOnly,
    true,
    "刚好低于上限时仍可判定"
  );
});

test("文件列表原样保留，便于面板展示", () => {
  const scope = classifyChangeScope(["README.md", "docs/a.md"]);
  assert.deepEqual(scope.files, ["README.md", "docs/a.md"]);
});
