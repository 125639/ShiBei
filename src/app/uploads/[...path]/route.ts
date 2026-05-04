import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

// 兜底服务 /uploads/<...> 路径下的文件。
//
// 背景:Next.js 生产模式 `next start` 启动时会一次性扫描 `public/` 目录,
// 把里面的文件登记进静态路由表。**运行时新增/同步进来的文件**(用户上传视频、
// 通过 ZIP import 写入的 mp4 等)即便落盘到了 `public/uploads/` 也不会被静态
// 路由命中,直到容器重启才会被重新扫描——表现为 404。
//
// 解决:静态命中优先(public/ 内已经存在于启动时的文件由 Next.js 直接服务,
// 此 route 不会被命中);只有当静态服务 miss 时,Next 才会路由到这里,
// 我们再亲自从磁盘读对应文件返回。这样任何时间点上传/同步进来的资源都能立即可见。
//
// 安全:严格把可服务的根固定在 process.cwd()/public/uploads,使用 path.resolve
// 后做边界检查,避免 ../ 之类的穿越。

export const dynamic = "force-dynamic";

// 仅暴露常见媒体/文档类型的 mime;未列出的统一回 octet-stream。
const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

function mimeOf(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segs } = await params;
  if (!segs || segs.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
  // 拼回路径前先逐段 decode,避免 %2e%2e 之类绕过。
  let rel: string;
  try {
    rel = segs.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  // 任意一个段是 '..' 直接拒绝。
  if (segs.some((s) => s === ".." || s === "." || s.includes("\0"))) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }

  const abs = path.resolve(uploadsRoot, rel);
  // 绝对必要的边界检查:abs 必须落在 uploadsRoot 内。
  if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + path.sep)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!stat.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const range = request.headers.get("range");
  const total = stat.size;
  const baseName = path.basename(abs);
  const headers = new Headers({
    "Content-Type": mimeOf(baseName),
    // 视频/音频要求 Range 支持以便边下边播。
    "Accept-Ranges": "bytes",
    // 与 next.config.ts 里 /uploads/:path* 的 header 配置保持一致。
    "Cache-Control": "public, max-age=3600, must-revalidate",
    "Last-Modified": stat.mtime.toUTCString(),
  });

  if (range) {
    // bytes=START-END
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const startRaw = m[1];
      const endRaw = m[2];
      let start: number;
      let end: number;
      if (startRaw === "" && endRaw !== "") {
        // suffix range: bytes=-N → 最后 N 字节
        const suffix = Number(endRaw);
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = Number(startRaw || 0);
        end = endRaw === "" ? total - 1 : Number(endRaw);
      }
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start > end ||
        start < 0 ||
        end >= total
      ) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      const chunkSize = end - start + 1;
      headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
      headers.set("Content-Length", String(chunkSize));
      const stream = fs.createReadStream(abs, { start, end });
      return new Response(streamToWeb(stream), { status: 206, headers });
    }
  }

  headers.set("Content-Length", String(total));
  const stream = fs.createReadStream(abs);
  return new Response(streamToWeb(stream), { status: 200, headers });
}

// fs.createReadStream 是 Node 流;Next/Web 需要 ReadableStream。
function streamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer | string) => {
        const u8 =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        controller.enqueue(u8);
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      // 调用方主动中断:关闭底层流以释放 fd。
      const s = nodeStream as unknown as { destroy?: (err?: unknown) => void };
      if (typeof s.destroy === "function") s.destroy();
    },
  });
}

// HEAD 走同一逻辑但不带 body。
export async function HEAD(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
