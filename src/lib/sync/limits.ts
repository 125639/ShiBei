import { getAppMode, type AppMode } from "../app-mode";

const MB = 1024 * 1024;

// ZIP 会被完整缓冲进内存（adm-zip 不支持流式解包），单个文件 entry.getData()
// 同样整体材料化。上限必须显著小于容器内存，否则是「先被 OOM 杀、后限流」：
// frontend 形态容器 448MB 由 Next + sync-worker 两个进程共享，512MB/350MB
// 的默认上限在那里形同虚设。frontend 默认收紧为 64MB 包 / 48MB 单文件
//（超限文件跳过不中断，走 filesSkipped + errors 提示）；
// 其他形态维持原值。SYNC_MAX_ZIP_MB / SYNC_MAX_FILE_MB 可按部署覆盖。
export function resolveSyncZipLimits(input: {
  mode: AppMode;
  env: Record<string, string | undefined>;
}): { zipBytes: number; singleFileBytes: number } {
  const envMb = (name: string): number | null => {
    const raw = Number(input.env[name]);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) * MB : null;
  };
  const frontend = input.mode === "frontend";
  return {
    zipBytes: envMb("SYNC_MAX_ZIP_MB") ?? (frontend ? 64 * MB : 512 * MB),
    singleFileBytes: envMb("SYNC_MAX_FILE_MB") ?? (frontend ? 48 * MB : 350 * MB)
  };
}

const SYNC_ZIP_LIMITS = resolveSyncZipLimits({ mode: getAppMode(), env: process.env });
export const MAX_SYNC_ZIP_BYTES = SYNC_ZIP_LIMITS.zipBytes;
export const MAX_SYNC_SINGLE_FILE_BYTES = SYNC_ZIP_LIMITS.singleFileBytes;

export const MAX_SYNC_JSON_BYTES = 50 * MB;
export const MAX_SYNC_FILE_ENTRIES = 2000;
export const MAX_SYNC_TOTAL_FILE_BYTES = 1024 * MB;
export const MAX_SYNC_POSTS = 20_000;
export const MAX_SYNC_VIDEOS = 20_000;

export async function readResponseBufferWithLimit(response: Response, maxBytes = MAX_SYNC_ZIP_BYTES): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error("同步包超过允许大小");
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("同步包超过允许大小");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
