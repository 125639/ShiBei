"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { exitSuggestion } from "@tiptap/suggestion";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "./slash-menu";

export type AiSelectionKind = "polish" | "shorten" | "expand" | "fix" | "translate";

export type AiSelectionRequest = {
  kind: AiSelectionKind;
  text: string;
  from: number;
  to: number;
};

const AI_ACTIONS: Array<{ kind: AiSelectionKind; label: string }> = [
  { kind: "polish", label: "润色" },
  { kind: "shorten", label: "精简" },
  { kind: "expand", label: "扩写" },
  { kind: "fix", label: "纠错" },
  { kind: "translate", label: "译英" }
];

type EditorRuntimeCallbacks = {
  aiEnabled: boolean;
  onAiContinue: () => void;
  onMarkdownChange: (docId: string, markdown: string) => void;
};

/**
 * Tiptap keeps the original extension instance for the lifetime of an editor.
 * This stable bridge lets that instance call the latest React callbacks without
 * reading a React ref during render or recreating the editor when props change.
 */
function createEditorRuntime(initialDocId: string, initialCallbacks: EditorRuntimeCallbacks) {
  let loadedDocId = initialDocId;
  let callbacks = initialCallbacks;

  return {
    updateCallbacks(next: EditorRuntimeCallbacks) {
      callbacks = next;
    },
    runAiContinue() {
      callbacks.onAiContinue();
    },
    isAiEnabled() {
      return callbacks.aiEnabled;
    },
    emitMarkdown(markdown: string) {
      callbacks.onMarkdownChange(loadedDocId, markdown);
    },
    getLoadedDocId() {
      return loadedDocId;
    },
    setLoadedDocId(nextDocId: string) {
      loadedDocId = nextDocId;
    }
  };
}

/**
 * Notion 式块编辑器:
 * - "/" 唤起块命令菜单(标题/列表/引用/代码块/分割线/AI 续写)
 * - 选中文本浮出格式工具栏(粗斜删码链)与 AI 动作
 * - markdown 双向:输入 markdown 快捷键(# 、- 、> 等)由 StarterKit 处理,
 *   内容通过 tiptap-markdown 以 markdown 存取,与全站 Post/文档存储格式一致
 */
export function NotionEditor({
  docId,
  initialMarkdown,
  editable = true,
  aiEnabled = false,
  placeholder = "输入 / 唤起命令，或直接开始写…",
  onMarkdownChange,
  onAiSelection,
  onAiContinue,
  onReady
}: {
  docId: string;
  initialMarkdown: string;
  editable?: boolean;
  aiEnabled?: boolean;
  placeholder?: string;
  onMarkdownChange: (docId: string, markdown: string) => void;
  onAiSelection: (request: AiSelectionRequest) => void;
  onAiContinue: () => void;
  onReady?: (editor: Editor) => void;
}) {
  const [runtime] = useState(() => createEditorRuntime(docId, {
    aiEnabled,
    onAiContinue,
    onMarkdownChange
  }));

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    editorProps: {
      attributes: {
        "aria-label": "文稿正文编辑器"
      }
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
        codeBlock: {},
        trailingNode: false
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "标题";
          return placeholder;
        }
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        transformPastedText: true,
        transformCopiedText: true
      }),
      SlashCommand.configure({
        onAiContinue: () => runtime.runAiContinue(),
        isAiEnabled: () => runtime.isAiEnabled()
      })
    ],
    content: initialMarkdown,
    onUpdate: ({ editor: current }) => {
      const storage = current.storage as unknown as { markdown: { getMarkdown(): string } };
      runtime.emitMarkdown(storage.markdown.getMarkdown());
    }
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // A document switch must replace ProseMirror content before editing is
  // re-enabled. A layout effect closes the render→passive-effect window in
  // which the new docId could otherwise still display and mutate the old body.
  useLayoutEffect(() => {
    runtime.updateCallbacks({ aiEnabled, onAiContinue, onMarkdownChange });
    if (!editor || editor.isDestroyed) return;
    const switchingDocument = runtime.getLoadedDocId() !== docId;
    if (switchingDocument || !editable) {
      editor.setEditable(false, false);
      exitSuggestion(editor.view);
      editor.commands.blur();
    }
    if (switchingDocument) {
      editor.commands.setContent(initialMarkdown, { emitUpdate: false });
      runtime.setLoadedDocId(docId);
    }
    editor.setEditable(editable, false);
  }, [aiEnabled, docId, editable, editor, initialMarkdown, onAiContinue, onMarkdownChange, runtime]);

  if (!editor) {
    return <div className="notion-editor notion-editor-loading" aria-busy="true" />;
  }

  const askAi = (kind: AiSelectionKind) => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    onAiSelection({ kind, text, from, to });
  };

  const setLink = () => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const existing = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址（留空移除链接）", existing || "https://");
    if (url === null) return;
    if (editor.isDestroyed || !editor.isEditable) return;
    if (!url.trim() || url.trim() === "https://") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url.trim() }).run();
  };

  return (
    <div className="notion-editor">
      <BubbleMenu
        editor={editor}
        options={{ placement: "top" }}
        shouldShow={({ editor: current, state }) => {
          if (!current.isEditable) return false;
          const { from, to } = state.selection;
          if (from === to) return false;
          return !current.isActive("codeBlock");
        }}
      >
        <div className="bubble-toolbar" role="toolbar" aria-label={aiEnabled ? "格式与 AI" : "文字格式"}>
          <button type="button" className={editor.isActive("bold") ? "active" : ""} aria-label="加粗" title="加粗" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (editor.isEditable) editor.chain().focus().toggleBold().run(); }}><strong>B</strong></button>
          <button type="button" className={editor.isActive("italic") ? "active" : ""} aria-label="斜体" title="斜体" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (editor.isEditable) editor.chain().focus().toggleItalic().run(); }}><em>I</em></button>
          <button type="button" className={editor.isActive("strike") ? "active" : ""} aria-label="删除线" title="删除线" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (editor.isEditable) editor.chain().focus().toggleStrike().run(); }}><s>S</s></button>
          <button type="button" className={editor.isActive("code") ? "active" : ""} aria-label="行内代码" title="行内代码" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (editor.isEditable) editor.chain().focus().toggleCode().run(); }}>{"<>"}</button>
          <button type="button" className={editor.isActive("link") ? "active" : ""} aria-label="编辑链接" title="链接" onMouseDown={(e) => e.preventDefault()} onClick={setLink}>🔗</button>
          {aiEnabled ? (
            <>
              <span className="bubble-divider" aria-hidden="true" />
              <span className="bubble-ai-label" aria-hidden="true">AI</span>
              {AI_ACTIONS.map((action) => (
                <button
                  key={action.kind}
                  type="button"
                  className="bubble-ai"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => askAi(action.kind)}
                >
                  {action.label}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
