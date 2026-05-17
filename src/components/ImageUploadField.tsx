"use client";

import { useId, useRef, useState } from "react";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
const MAX_BYTES = 8 * 1024 * 1024;

type Props = {
  id?: string;
  name?: string;
  required?: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageUploadField({ id, name = "file", required }: Props) {
  const reactId = useId();
  const inputId = id || reactId;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ name: string; size: number; tooLarge: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  function takeFile(file: File | undefined | null) {
    if (!file) {
      setMeta(null);
      setPreview(null);
      return;
    }
    const tooLarge = file.size > MAX_BYTES;
    setMeta({ name: file.name, size: file.size, tooLarge });
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div
      className={`image-upload-field${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && inputRef.current) {
          const dt = new DataTransfer();
          dt.items.add(file);
          inputRef.current.files = dt.files;
          takeFile(file);
        }
      }}
    >
      <label htmlFor={inputId} className="image-upload-dropzone">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          name={name}
          accept={ACCEPT}
          required={required}
          onChange={(event) => takeFile(event.target.files?.[0])}
          aria-describedby={`${inputId}-hint`}
        />
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={preview} alt="" className="image-upload-thumb" />
        ) : (
          <span className="image-upload-placeholder">
            <strong>点击选择,或将图片拖到此处</strong>
            <span className="muted">支持 JPG / PNG / WebP / GIF · 上限 8 MB</span>
          </span>
        )}
      </label>
      <small id={`${inputId}-hint`} className="muted image-upload-hint">
        {meta ? (
          <>
            {meta.name} · {formatBytes(meta.size)}
            {meta.tooLarge ? (
              <strong className="image-upload-error"> · 超过 8 MB 上限,请先压缩</strong>
            ) : null}
          </>
        ) : (
          "JPG / PNG / WebP / GIF · 单文件上限 8 MB"
        )}
      </small>
    </div>
  );
}
