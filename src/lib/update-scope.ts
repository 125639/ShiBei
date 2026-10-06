// 更新提示的「变更范围」判定。
//
// 运行镜像只包含 scripts/package-runtime.mjs 打包出来的内容（.next / public /
// prisma / scripts / src 与几个配置文件），所以 docs/、tests/、.github/ 和仓库
// 根目录的 Markdown 改了并不会影响线上运行。这类「纯文档提交」不应该弹更新
// 提示 —— 否则每改一次 README 都得重建镜像才能让提示消失，pull 模式下还会
// 反复提示却永远修不好（拉回来的镜像标记不变）。
//
// 保守原则：拿不到文件列表、列表为空、或可能被截断时，一律按「需要更新」处理。
// 漏报一个真实更新，比多提示一次要严重得多。
//
// 同一份判定要和 scripts/updater/server.mjs 配合：updater 只负责上报变更文件
// 列表（changedFiles / changedFilesTruncated），是否算「影响镜像」由这里决定。

// 与 GitHub compare API 单次返回的文件数上限一致；达到这个数量就认为列表可能被截断。
export const UPDATE_SCOPE_MAX_FILES = 300;

// 不影响运行镜像的路径。
const INERT_PATH_PATTERNS: readonly RegExp[] = [
  /^docs\//i,
  /^tests\//i,
  /^\.github\//i,
  /^[^/]+\.md$/i
];

export function isInertUpdatePath(file: string): boolean {
  const path = file.trim().replace(/^\.\//, "");
  if (!path) return false;
  // 出现 ".." 的路径不可信（可能绕过前缀匹配），按影响镜像处理。
  if (path.includes("..")) return false;
  return INERT_PATH_PATTERNS.some((re) => re.test(path));
}

export type ChangeScope = {
  /** 远端新提交是否只动了不影响镜像的路径 */
  docsOnly: boolean;
  /** 文件列表是否可能被截断（截断时不做 docsOnly 判定） */
  truncated: boolean;
  files: string[];
};

export function classifyChangeScope(files: unknown, truncated = false): ChangeScope {
  const list = Array.isArray(files)
    ? files.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const cut = truncated || list.length >= UPDATE_SCOPE_MAX_FILES;
  return {
    docsOnly: !cut && list.length > 0 && list.every(isInertUpdatePath),
    truncated: cut,
    files: list
  };
}
