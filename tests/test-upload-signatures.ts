import assert from "node:assert/strict";
import test from "node:test";
import { detectMediaContainer, mediaUploadSignatureProblem } from "../src/lib/upload-signatures";

const ascii = (text: string) => Uint8Array.from(Buffer.from(text, "ascii"));

test("audio upload signatures match their declared extensions", () => {
  assert.equal(detectMediaContainer(ascii("ID3\u0004\u0000\u0000")), "mp3");
  assert.equal(mediaUploadSignatureProblem(ascii("ID3\u0004\u0000\u0000"), ".mp3", "music"), null);
  assert.equal(mediaUploadSignatureProblem(ascii("OggS\u0000\u0002"), ".ogg", "music"), null);
  assert.equal(mediaUploadSignatureProblem(ascii("RIFF1234WAVEfmt "), ".wav", "music"), null);
  assert.match(mediaUploadSignatureProblem(ascii("not really audio"), ".mp3", "music") || "", /不匹配/);
});

test("video signatures accept ISO BMFF/WebM and reject renamed payloads", () => {
  const mp4 = Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypisom0000", "ascii")]);
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
  assert.equal(mediaUploadSignatureProblem(mp4, ".mp4", "video"), null);
  assert.equal(mediaUploadSignatureProblem(mp4, ".mov", "video"), null);
  assert.equal(mediaUploadSignatureProblem(webm, ".webm", "video"), null);
  assert.match(mediaUploadSignatureProblem(ascii("<script>alert(1)"), ".mp4", "video") || "", /不匹配/);
  assert.match(mediaUploadSignatureProblem(mp4, ".webm", "video") || "", /不匹配/);
});
