import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 把浏览器上传的 File 流式写盘，带大小上限与背压。
 * 用 pipeline 而不是手写 read/write 循环：写流的 error（EEXIST/ENOSPC/EACCES…）
 * 可能在任何 await 间隙触发，pipeline 保证始终有监听器，不会变成
 * 未处理的 'error' 事件把进程打崩。
 */
export async function writeUploadedFile(file: File, destination: string, maxBytes: number) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(new Error("uploaded file exceeds size limit"));
      else callback(null, chunk);
    }
  });
  // wx：目标已存在时失败，避免静默覆盖（调用方都用随机文件名，正常不会触发）。
  const out = fs.createWriteStream(destination, { flags: "wx" });

  try {
    await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), limiter, out);
  } catch (error) {
    // EEXIST 时文件是别人的，不能删；其余失败清掉半成品。
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
      await fsp.unlink(destination).catch(() => undefined);
    }
    throw error;
  }

  return bytes;
}

export async function readUploadedFileBuffer(file: File, maxBytes: number) {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("uploaded file exceeds size limit");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
