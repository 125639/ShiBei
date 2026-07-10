"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
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
  placeholder = "输入 / 唤起命令，或直接开始写…",
  onMarkdownChange,
  onAiSelection,
  onAiContinue,
  onReady
}: {
  docId: string;
  initialMarkdown: string;
  placeholder?: string;
  onMarkdownChange: (markdown: string) => void;
  onAiSelection: (request: AiSelectionRequest) => void;
  onAiContinue: () => void;
  onReady?: (editor: Editor) => void;
}) {
  // 回调走 ref,避免把易变函数塞进 extension 配置导致编辑器重建
  const aiContinueRef = useRef(onAiContinue);
  aiContinueRef.current = onAiContinue;
  const changeRef = useRef(onMarkdownChange);
  changeRef.current = onMarkdownChange;

  const editor = useEditor({
    immediatelyRender: false,
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
      SlashCommand.configure({ onAiContinue: () => aiContinueRef.current() })
    ],
    content: initialMarkdown,
    onUpdate: ({ editor: current }) => {
      const storage = current.storage as unknown as { markdown: { getMarkdown(): string } };
      changeRef.current(storage.markdown.getMarkdown());
    }
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // 切换文档时替换内容(setContent 会经 markdown 解析)
  const lastDocRef = useRef(docId);
  useEffect(() => {
    if (!editor || lastDocRef.current === docId) return;
    lastDocRef.current = docId;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor]);

  if (!editor) {
    return <div className="notion-editor notion-editor-loading" aria-busy="true" />;
  }

  const askAi = (kind: AiSelectionKind) => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    onAiSelection({ kind, text, from, to });
  };

  const setLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址（留空移除链接）", existing || "https://");
    if (url === null) return;
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
        <div className="bubble-toolbar" role="toolbar" aria-label="格式与 AI">
          <button type="button" className={editor.isActive("bold") ? "active" : ""} title="加粗" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}><strong>B</strong></button>
          <button type="button" className={editor.isActive("italic") ? "active" : ""} title="斜体" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}><em>I</em></button>
          <button type="button" className={editor.isActive("strike") ? "active" : ""} title="删除线" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}><s>S</s></button>
          <button type="button" className={editor.isActive("code") ? "active" : ""} title="行内代码" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}>{"<>"}</button>
          <button type="button" className={editor.isActive("link") ? "active" : ""} title="链接" onMouseDown={(e) => { e.preventDefault(); setLink(); }}>🔗</button>
          <span className="bubble-divider" aria-hidden="true" />
          <span className="bubble-ai-label" aria-hidden="true">AI</span>
          {AI_ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              className="bubble-ai"
              onMouseDown={(e) => {
                e.preventDefault();
                askAi(action.kind);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
