import path from "node:path";

/**
 * 把数据库中存储的 localPath / filePath（形如 "/uploads/video/abc.mp4"）
 * 解析为可安全删除/读取的绝对路径,严格限定在 public/uploads 目录内。
 *
 * 任何越界、空、含 NUL 字节的路径都返回 null,调用方应跳过该项。
 *
 * 使用场景:
 *   - 同步导入/导出时拷贝 mp4
 *   - 后台删除 Music / Video 时 unlink
 *   - 缓存清理时根据 DB 行 unlink
 *
 * 不在此处直接 fs.unlink/readFile,因为不同调用点对 missing-file 容错策略不同
 * (有的要报错,有的要 silently skip);把"绝对路径解析"和"实际 IO"解耦更清晰。
 */
export function resolveUploadsPath(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  if (relPath.includes("\0")) return null;
  const rel = relPath.replace(/^\/+/, "");
  if (!rel.startsWith("uploads/")) return null;
  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
  const abs = path.resolve(process.cwd(), "public", rel);
  if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + path.sep)) return null;
  return abs;
}
