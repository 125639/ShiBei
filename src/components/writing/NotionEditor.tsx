"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { exitSuggestion } from "@tiptap/suggestion";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "./slash-menu";
import { useDismissableOverlay } from "@/components/useDismissableOverlay";

// 块级右键/手柄菜单里的"转换为"目标；run 在已选中目标块的前提下执行。
const TURN_INTO: Array<{ id: string; label: string; run: (editor: Editor) => void }> = [
  { id: "paragraph", label: "正文", run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h1", label: "标题 1", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", label: "标题 2", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", label: "标题 3", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "bullet", label: "无序列表", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "ordered", label: "有序列表", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "quote", label: "引用", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "代码块", run: (e) => e.chain().focus().toggleCodeBlock().run() }
];

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

  // 手柄当前指向的块在文档中的位置（onNodeChange 持续更新）。
  const blockPosRef = useRef<number | null>(null);
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const blockMenuRef = useRef<HTMLDivElement | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number } | null>(null);

  // 必须是稳定引用：DragHandle 的注册 effect 把 onNodeChange 列入依赖，内联函数
  // 会让它每次渲染都 unregister→registerPlugin，reconfigure 时 ProseMirror 会摧毁
  // 并重建全部插件视图——包括斜杠命令的 Suggestion 视图，导致每个键位都把菜单状态
  // 清零、菜单永远弹不出来（2026-07-19 实测）。
  const handleNodeChange = useCallback(({ pos }: { pos: number }) => {
    blockPosRef.current = pos;
  }, []);

  useDismissableOverlay(Boolean(blockMenu), blockMenuRef, () => setBlockMenu(null), gripRef);

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

  // ── 左侧手柄动作（都基于 blockPosRef 指向的块）──
  const hoveredNode = () => {
    const pos = blockPosRef.current;
    if (pos == null) return null;
    return { pos, node: editor.state.doc.nodeAt(pos) };
  };

  // "+"：在当前块下方插入空段落并打出 "/"，直接进入块命令（Notion 同款）。
  const addBlockBelow = () => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const target = hoveredNode();
    if (!target) return;
    const insertAt = target.node ? target.pos + target.node.nodeSize : editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(insertAt, { type: "paragraph" }).setTextSelection(insertAt + 1).run();
    editor.chain().focus().insertContent("/").run();
  };

  const openBlockMenu = () => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const rect = gripRef.current?.getBoundingClientRect();
    if (!rect) return;
    setBlockMenu({ x: rect.right + 6, y: rect.top });
  };

  const turnHoveredInto = (item: (typeof TURN_INTO)[number]) => {
    const target = hoveredNode();
    if (!target) return;
    editor.chain().setTextSelection(target.pos + 1).run();
    item.run(editor);
    setBlockMenu(null);
  };

  const duplicateBlock = () => {
    const target = hoveredNode();
    if (!target?.node) return;
    editor.chain().focus().insertContentAt(target.pos + target.node.nodeSize, target.node.toJSON()).run();
    setBlockMenu(null);
  };

  const deleteBlock = () => {
    const target = hoveredNode();
    if (!target?.node) return;
    editor.chain().focus().deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize }).run();
    setBlockMenu(null);
  };

  return (
    <div className="notion-editor">
      {editable ? (
        <DragHandle
          editor={editor}
          onNodeChange={handleNodeChange}
        >
          <div className="notion-gutter" aria-hidden={false}>
            <button
              type="button"
              className="notion-gutter-btn"
              aria-label="在下方插入块"
              title="插入块"
              draggable={false}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={addBlockBelow}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button
              ref={gripRef}
              type="button"
              className="notion-gutter-btn notion-grip"
              aria-label="拖动重排，或点击打开块菜单"
              title="拖动重排 / 点击菜单"
              onClick={openBlockMenu}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>
            </button>
          </div>
        </DragHandle>
      ) : null}

      {blockMenu ? (
        <div
          ref={blockMenuRef}
          className="notion-block-menu"
          role="menu"
          aria-label="块操作"
          style={{ position: "fixed", top: blockMenu.y, left: blockMenu.x, zIndex: 320 }}
        >
          <p className="notion-block-menu-label">转换为</p>
          {TURN_INTO.map((item) => (
            <button key={item.id} type="button" role="menuitem" className="notion-block-menu-item" onClick={() => turnHoveredInto(item)}>
              {item.label}
            </button>
          ))}
          <span className="notion-block-menu-divider" aria-hidden="true" />
          <button type="button" role="menuitem" className="notion-block-menu-item" onClick={duplicateBlock}>复制块</button>
          <button type="button" role="menuitem" className="notion-block-menu-item danger" onClick={deleteBlock}>删除块</button>
        </div>
      ) : null}

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
