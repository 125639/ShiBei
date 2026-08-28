"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  countMarkdownText,
  formatMarkdownSelection,
  type MarkdownFormatAction
} from "@/lib/admin-markdown-editor";
import { markdownToHtml, type VideoForShortcode } from "@/lib/markdown";
import { I18nText } from "./I18nText";

type WorkspaceMode = "split" | "edit" | "preview";
const EMPTY_PREVIEW_VIDEOS: VideoForShortcode[] = [];

const OPEN_FOCUS_WORKSPACES = new Set<string>();
let activeFocusWorkspace: {
  id: string;
  close: () => void;
  suppressFocusRestore: () => void;
} | null = null;

function syncFocusBodyClass() {
  document.body.classList.toggle("admin-editor-focus-open", OPEN_FOCUS_WORKSPACES.size > 0);
}

function focusableElements(container: HTMLElement) {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled]):not([tabindex='-1'])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    if (element.closest("[aria-hidden='true']")) return false;
    return element.getClientRects().length > 0;
  });
}

export function markdownWorkspaceModeA11y(mode: WorkspaceMode) {
  const previewOnly = mode === "preview";
  return {
    sourceAriaHidden: previewOnly,
    sourceTabIndex: previewOnly ? -1 : undefined,
    formatActionsDisabled: previewOnly
  };
}

export function markdownWorkspaceDialogA11y(focused: boolean) {
  return {
    role: focused ? ("dialog" as const) : undefined,
    "aria-modal": focused ? true : undefined,
    tabIndex: focused ? -1 : undefined
  };
}

const FORMAT_ACTIONS: Array<{
  action: MarkdownFormatAction;
  zh: string;
  en: string;
  glyph: string;
  title: string;
}> = [
  { action: "heading", zh: "小标题", en: "Heading", glyph: "H2", title: "插入二级标题" },
  { action: "bold", zh: "加粗", en: "Bold", glyph: "B", title: "加粗选中文字" },
  { action: "italic", zh: "斜体", en: "Italic", glyph: "I", title: "斜体" },
  { action: "quote", zh: "引用", en: "Quote", glyph: "❝", title: "插入引用" },
  { action: "bullet", zh: "列表", en: "List", glyph: "☷", title: "插入无序列表" },
  { action: "link", zh: "链接", en: "Link", glyph: "↗", title: "插入链接" },
  { action: "image", zh: "图片", en: "Image", glyph: "▧", title: "插入图片语法" },
  { action: "code", zh: "代码", en: "Code", glyph: "</>", title: "插入行内代码" },
  { action: "divider", zh: "分隔线", en: "Divider", glyph: "—", title: "插入分隔线" }
];

export function AdminMarkdownWorkspace({
  id,
  name,
  initialValue,
  required = false,
  compact = false,
  previewVideos = EMPTY_PREVIEW_VIDEOS,
  label
}: {
  id: string;
  name: string;
  initialValue: string;
  required?: boolean;
  compact?: boolean;
  previewVideos?: VideoForShortcode[];
  label: React.ReactNode;
}) {
  const instanceId = useId().replace(/:/g, "");
  const workspaceId = `${id}-markdown-workspace-${instanceId}`;
  const labelId = `${workspaceId}-label`;
  const helpId = `${workspaceId}-help`;
  const workspaceRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const focusButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = useRef(true);
  const lastFocusInsideRef = useRef<HTMLElement | null>(null);
  const modeRef = useRef<WorkspaceMode>("split");
  const [markdown, setMarkdown] = useState(initialValue);
  const [mode, setMode] = useState<WorkspaceMode>("split");
  const [focused, setFocused] = useState(false);
  const deferredMarkdown = useDeferredValue(markdown);
  const stats = useMemo(() => countMarkdownText(markdown), [markdown]);
  const videosById = useMemo(() => new Map(previewVideos.map((video) => [video.id, video])), [previewVideos]);
  const previewHtml = useMemo(
    () => markdownToHtml(deferredMarkdown, { videosById }),
    [deferredMarkdown, videosById]
  );
  const modeA11y = markdownWorkspaceModeA11y(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // A stacked split view makes the default editor unnecessarily tall on a
  // phone. Start narrow screens in the focused editing view; users can still
  // opt into Split or Preview from the view controls.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 820px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      setMode((current) => current === "split" ? "edit" : current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Native listener also catches PostEditAssist, which intentionally writes to
  // this textarea through the DOM before dispatching input/change events.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const sync = () => setMarkdown(textarea.value);
    textarea.addEventListener("input", sync);
    textarea.addEventListener("change", sync);
    return () => {
      textarea.removeEventListener("input", sync);
      textarea.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!focused) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    if (activeFocusWorkspace && activeFocusWorkspace.id !== workspaceId) {
      activeFocusWorkspace.suppressFocusRestore();
      activeFocusWorkspace.close();
    }

    const owner = {
      id: workspaceId,
      close: () => setFocused(false),
      suppressFocusRestore: () => {
        restoreFocusOnCloseRef.current = false;
      }
    };
    activeFocusWorkspace = owner;
    OPEN_FOCUS_WORKSPACES.add(workspaceId);
    syncFocusBodyClass();

    const initialFocusFrame = window.requestAnimationFrame(() => {
      const initialTarget = modeRef.current === "preview" ? previewRef.current : textareaRef.current;
      (initialTarget || workspace).focus();
    });

    const constrainFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFocused(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(workspace);
      if (!focusable.length) {
        event.preventDefault();
        workspace.focus();
        return;
      }

      const active = document.activeElement;
      const activeIndex = focusable.findIndex((element) => element === active);
      const target = event.shiftKey
        ? (activeIndex <= 0 ? focusable[focusable.length - 1] : null)
        : (activeIndex < 0 || activeIndex === focusable.length - 1 ? focusable[0] : null);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && workspace.contains(target)) {
        lastFocusInsideRef.current = target;
        return;
      }
      const lastTarget = lastFocusInsideRef.current;
      const fallback = lastTarget && workspace.contains(lastTarget)
        ? lastTarget
        : focusableElements(workspace)[0] || workspace;
      fallback.focus();
    };

    document.addEventListener("keydown", constrainFocus);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      document.removeEventListener("keydown", constrainFocus);
      document.removeEventListener("focusin", keepFocusInside);
      OPEN_FOCUS_WORKSPACES.delete(workspaceId);
      syncFocusBodyClass();
      if (activeFocusWorkspace === owner) activeFocusWorkspace = null;

      const returnTarget = returnFocusRef.current;
      if (restoreFocusOnCloseRef.current && returnTarget?.isConnected) {
        window.requestAnimationFrame(() => returnTarget.focus());
      }
      lastFocusInsideRef.current = null;
    };
  }, [focused, workspaceId]);

  function toggleFocusMode() {
    if (focused) {
      setFocused(false);
      return;
    }
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : focusButtonRef.current;
    restoreFocusOnCloseRef.current = true;
    setFocused(true);
  }

  function applyFormat(action: MarkdownFormatAction) {
    if (modeA11y.formatActionsDisabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = formatMarkdownSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      action
    );
    textarea.value = result.value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  }

  function syncPreviewScroll() {
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!textarea || !preview || mode !== "split") return;
    const sourceRange = textarea.scrollHeight - textarea.clientHeight;
    const previewRange = preview.scrollHeight - preview.clientHeight;
    if (sourceRange <= 0 || previewRange <= 0) return;
    preview.scrollTop = (textarea.scrollTop / sourceRange) * previewRange;
  }

  return (
    <section
      {...markdownWorkspaceDialogA11y(focused)}
      id={workspaceId}
      ref={workspaceRef}
      className={`admin-markdown-workspace${compact ? " compact" : ""}${focused ? " focus-mode" : ""}`}
      aria-labelledby={labelId}
      aria-describedby={focused ? helpId : undefined}
    >
      <div className="admin-markdown-head">
        <div>
          <label id={labelId} className="admin-markdown-label" htmlFor={id}>{label}</label>
          <p><I18nText zh="左侧写作，右侧直接核对读者最终看到的成稿。" en="Write on the left and verify the reader-facing article on the right." /></p>
        </div>
        <div className="admin-markdown-meta" aria-live="polite">
          <span>{stats.characters.toLocaleString("zh-CN")} <I18nText zh="字符" en="chars" /></span>
          <span>{stats.lines.toLocaleString("zh-CN")} <I18nText zh="行" en="lines" /></span>
        </div>
      </div>

      <div className="admin-markdown-controls">
        <div className="admin-markdown-tabs" role="group" aria-label="编辑器视图">
          <ViewButton active={mode === "split"} onClick={() => setMode("split")}><I18nText zh="双栏" en="Split" /></ViewButton>
          <ViewButton active={mode === "edit"} onClick={() => setMode("edit")}><I18nText zh="只编辑" en="Edit" /></ViewButton>
          <ViewButton active={mode === "preview"} onClick={() => setMode("preview")}><I18nText zh="只看成稿" en="Preview" /></ViewButton>
        </div>
        <button
          ref={focusButtonRef}
          className="button secondary admin-editor-focus-button"
          type="button"
          aria-expanded={focused}
          aria-controls={workspaceId}
          aria-haspopup="dialog"
          onClick={toggleFocusMode}
        >
          {focused ? <I18nText zh="退出专注" en="Exit focus" /> : <I18nText zh="专注写作" en="Focus" />}
        </button>
      </div>

      <div className="admin-markdown-formatbar" role="toolbar" aria-label="Markdown 快捷格式">
        {FORMAT_ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            title={item.title}
            aria-label={item.title}
            disabled={modeA11y.formatActionsDisabled}
            onClick={() => applyFormat(item.action)}
          >
            <span aria-hidden="true">{item.glyph}</span>
            <I18nText zh={item.zh} en={item.en} />
          </button>
        ))}
      </div>

      <div className={`admin-markdown-panels mode-${mode}`}>
        <div className="admin-markdown-source-panel" aria-hidden={modeA11y.sourceAriaHidden || undefined}>
          <div className="admin-markdown-panel-label">
            <span><I18nText zh="编辑内容" en="Edit content" /></span>
            <span className="muted"><I18nText zh="支持 Markdown" en="Markdown supported" /></span>
          </div>
          <textarea
            id={id}
            name={name}
            ref={textareaRef}
            defaultValue={initialValue}
            required={required}
            tabIndex={modeA11y.sourceTabIndex}
            onInvalid={() => {
              setMode("edit");
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            onScroll={syncPreviewScroll}
            spellCheck
            wrap="soft"
          />
        </div>
        <div className="admin-markdown-preview-panel">
          <div className="admin-markdown-panel-label">
            <span><I18nText zh="成稿预览" en="Article preview" /></span>
            <span className="admin-preview-live"><span aria-hidden="true" /> <I18nText zh="实时更新" en="Live" /></span>
          </div>
          <article
            ref={previewRef}
            className="admin-markdown-preview prose"
            aria-label="文章实时预览"
            tabIndex={0}
          >
            {deferredMarkdown.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="empty-state">
                <p><I18nText zh="开始输入后，这里会显示排版后的文章。" en="The formatted article will appear here as you type." /></p>
              </div>
            )}
          </article>
        </div>
      </div>

      <p id={helpId} className="admin-markdown-help">
        <I18nText
          zh="提示：先选中文字再点上方按钮即可加粗、加链接或转为标题；无需手动辨认符号。专注模式按 Esc 可退出。"
          en="Tip: select text, then use the toolbar to format it without memorizing Markdown. Press Esc to leave focus mode."
        />
      </p>
    </section>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} className={active ? "active" : ""} onClick={onClick}>
      {children}
    </button>
  );
}
