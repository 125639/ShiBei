"use client";

import { useEffect, useId, useRef, useState } from "react";
import { I18nText } from "./I18nText";

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

  // 卸载或换图时回收 object URL，避免长会话下内存泄漏。
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function takeFile(file: File | undefined | null) {
    if (!file) {
      setMeta(null);
      setPreview(null);
      return;
    }
    const tooLarge = file.size > MAX_BYTES;
    setMeta({ name: file.name, size: file.size, tooLarge });
    setPreview(URL.createObjectURL(file));
    // 超限时把校验消息挂到 input 上：浏览器会拦截提交并在字段旁给出提示，
    // 不需要等服务端 413 才发现问题。
    inputRef.current?.setCustomValidity(
      tooLarge ? `图片 ${formatBytes(file.size)} 超过 8 MB 上限，请先压缩` : ""
    );
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
          aria-invalid={meta?.tooLarge || undefined}
        />
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={preview} alt="所选图片预览" className="image-upload-thumb" />
        ) : (
          <span className="image-upload-placeholder">
            <strong><I18nText zh="点击选择,或将图片拖到此处" en="Click to choose, or drop an image here" /></strong>
            <span className="muted">JPG / PNG / WebP / GIF · ≤ 8 MB</span>
          </span>
        )}
      </label>
      <small id={`${inputId}-hint`} className="muted image-upload-hint" role={meta?.tooLarge ? "alert" : undefined}>
        {meta ? (
          <>
            {meta.name} · {formatBytes(meta.size)}
            {meta.tooLarge ? (
              <strong className="image-upload-error"> · <I18nText zh="超过 8 MB 上限,请先压缩" en="over the 8 MB limit — compress first" /></strong>
            ) : null}
          </>
        ) : (
          "JPG / PNG / WebP / GIF · ≤ 8 MB"
        )}
      </small>
    </div>
  );
}
