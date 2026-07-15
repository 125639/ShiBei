export type UploadMediaKind = "music" | "video";

type MediaContainer = "mp3" | "aac" | "ogg" | "wav" | "iso-bmff" | "webm" | "unknown";

export function detectMediaContainer(input: Uint8Array): MediaContainer {
  const ascii = (start: number, end: number) => String.fromCharCode(...input.slice(start, end));
  if (input.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (input.length >= 4 && ascii(0, 4) === "OggS") return "ogg";
  if (input.length >= 4 && input[0] === 0x1a && input[1] === 0x45 && input[2] === 0xdf && input[3] === 0xa3) return "webm";
  if (input.length >= 12 && ascii(4, 8) === "ftyp") return "iso-bmff";
  if (input.length >= 3 && ascii(0, 3) === "ID3") return "mp3";
  if (input.length >= 2 && input[0] === 0xff && (input[1] & 0xe0) === 0xe0) {
    // ADTS AAC uses a 12-bit sync word and layer bits 00. Other MPEG audio
    // frame headers are accepted as MP3.
    return (input[1] & 0xf6) === 0xf0 ? "aac" : "mp3";
  }
  if (input.length >= 4 && ascii(0, 4) === "ADIF") return "aac";
  return "unknown";
}

const MUSIC_CONTAINER_BY_EXT: Record<string, MediaContainer[]> = {
  ".mp3": ["mp3"],
  ".m4a": ["iso-bmff"],
  ".aac": ["aac"],
  ".ogg": ["ogg"],
  ".wav": ["wav"]
};

const VIDEO_CONTAINER_BY_EXT: Record<string, MediaContainer[]> = {
  ".mp4": ["iso-bmff"],
  ".mov": ["iso-bmff"],
  ".m4v": ["iso-bmff"],
  ".webm": ["webm"]
};

export function mediaUploadSignatureProblem(
  bytes: Uint8Array,
  extension: string,
  kind: UploadMediaKind
): string | null {
  const ext = extension.toLowerCase();
  const expected = (kind === "music" ? MUSIC_CONTAINER_BY_EXT : VIDEO_CONTAINER_BY_EXT)[ext];
  if (!expected) return `不支持的${kind === "music" ? "音频" : "视频"}扩展名：${ext || "（无）"}`;
  const actual = detectMediaContainer(bytes);
  if (!expected.includes(actual)) {
    return `文件内容与扩展名 ${ext} 不匹配，已拒绝保存`;
  }
  return null;
}

export async function uploadedMediaSignatureProblem(file: File, extension: string, kind: UploadMediaKind) {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return mediaUploadSignatureProblem(header, extension, kind);
}
