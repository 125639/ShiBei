export const MAX_SYNC_ZIP_BYTES = 512 * 1024 * 1024;
export const MAX_SYNC_JSON_BYTES = 50 * 1024 * 1024;
export const MAX_SYNC_FILE_ENTRIES = 2000;
export const MAX_SYNC_SINGLE_FILE_BYTES = 350 * 1024 * 1024;
export const MAX_SYNC_TOTAL_FILE_BYTES = 1024 * 1024 * 1024;
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

