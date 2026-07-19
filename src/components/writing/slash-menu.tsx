"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";

// Notion 式斜杠菜单:输入 / 唤起块类型命令,支持关键词过滤与键盘导航。

export type SlashItem = {
  id: string;
  title: string;
  hint: string;
  keywords: string;
  icon: ReactNode;
  run: (editor: Editor, range: Range) => void;
};

// 16px 线性块类型图标（与站点 ICON 风格一致）。
const IC = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true
};
const SLASH_ICONS: Record<string, ReactNode> = {
  text: <svg {...IC}><path d="M5 5h14M5 5v14M12 5v14" /></svg>,
  h1: <svg {...IC}><path d="M4 6v12M12 6v12M4 12h8M17 9l3-1.5V18" /></svg>,
  h2: <svg {...IC}><path d="M4 6v12M11 6v12M4 12h7M16 9.5a2 2 0 1 1 3.4 1.4L16 18h4" /></svg>,
  h3: <svg {...IC}><path d="M4 6v12M11 6v12M4 12h7M16 8.5a1.8 1.8 0 1 1 2.8 2.2 1.8 1.8 0 1 1-2.6 2.6" /></svg>,
  bullet: <svg {...IC}><circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="17" r="1.3" fill="currentColor" stroke="none" /><path d="M10 7h10M10 12h10M10 17h10" /></svg>,
  ordered: <svg {...IC}><path d="M10 7h10M10 12h10M10 17h10M4 6.5h1.2V10M4 15h2v1.5H4V18h2" /></svg>,
  quote: <svg {...IC}><path d="M7 7v10M5 7h4M11 9h8M11 13h8M11 17h5" /></svg>,
  code: <svg {...IC}><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></svg>,
  divider: <svg {...IC}><path d="M4 12h16" /></svg>,
  "ai-continue": <svg {...IC}><path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg>
};

function runIfEditable(editor: Editor, action: () => void) {
  if (editor.isEditable) action();
}

export function buildSlashItems(onAiContinue?: () => void): SlashItem[] {
  const items: Array<Omit<SlashItem, "icon">> = [
    {
      id: "text",
      title: "正文",
      hint: "普通段落",
      keywords: "text paragraph 正文 段落 zhengwen",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).setParagraph().run())
    },
    {
      id: "h1",
      title: "标题 1",
      hint: "大节标题",
      keywords: "h1 heading1 标题 大标题 biaoti",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run())
    },
    {
      id: "h2",
      title: "标题 2",
      hint: "中节标题",
      keywords: "h2 heading2 标题 biaoti",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run())
    },
    {
      id: "h3",
      title: "标题 3",
      hint: "小节标题",
      keywords: "h3 heading3 标题 biaoti",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run())
    },
    {
      id: "bullet",
      title: "无序列表",
      hint: "• 项目符号",
      keywords: "bullet list ul 列表 无序 liebiao",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).toggleBulletList().run())
    },
    {
      id: "ordered",
      title: "有序列表",
      hint: "1. 编号列表",
      keywords: "ordered number ol 列表 有序 编号",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).toggleOrderedList().run())
    },
    {
      id: "quote",
      title: "引用",
      hint: "引言块",
      keywords: "quote blockquote 引用 yinyong",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).toggleBlockquote().run())
    },
    {
      id: "code",
      title: "代码块",
      hint: "等宽代码",
      keywords: "code codeblock 代码 daima",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).toggleCodeBlock().run())
    },
    {
      id: "divider",
      title: "分割线",
      hint: "水平分隔",
      keywords: "divider hr line 分割 分隔 fenge",
      run: (editor, range) => runIfEditable(editor, () => editor.chain().focus().deleteRange(range).setHorizontalRule().run())
    }
  ];
  if (onAiContinue) {
    items.push({
      id: "ai-continue",
      title: "AI 续写",
      hint: "根据上文继续写",
      keywords: "ai continue 续写 xuxie 继续",
      run: (editor, range) => {
        if (!editor.isEditable) return;
        editor.chain().focus().deleteRange(range).run();
        onAiContinue();
      }
    });
  }
  return items.map((item) => ({ ...item, icon: SLASH_ICONS[item.id] ?? SLASH_ICONS.text }));
}

type SlashListProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export type SlashListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

export const SlashList = forwardRef<SlashListHandle, SlashListProps>(function SlashList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setSelected((current) => (current + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((current) => (current - 1 + items.length) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter") {
        if (items[selected]) command(items[selected]);
        return true;
      }
      return false;
    }
  }));

  if (!items.length) {
    return <div className="slash-menu"><div className="slash-empty">没有匹配的命令</div></div>;
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="插入块">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selected}
          className={`slash-item${index === selected ? " active" : ""}${item.id === "ai-continue" ? " slash-ai" : ""}`}
          onMouseEnter={() => setSelected(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            command(item);
          }}
        >
          <span className="slash-item-icon" aria-hidden="true">{item.icon}</span>
          <span className="slash-item-body">
            <span className="slash-item-title">{item.title}</span>
            <span className="slash-item-hint">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

/** 渲染层:把 SlashList 挂到 body,按 Suggestion 的 clientRect 定位。 */
function createSlashRenderer() {
  let renderer: ReactRenderer<SlashListHandle, SlashListProps> | null = null;

  const destroy = () => {
    renderer?.element.remove();
    renderer?.destroy();
    renderer = null;
  };

  const position = (props: SuggestionProps<SlashItem>) => {
    const rect = props.clientRect?.();
    if (!rect || !renderer?.element) return;
    const el = renderer.element as HTMLElement;
    el.style.position = "fixed";
    el.style.zIndex = "300";
    const menuHeight = Math.min(el.offsetHeight || 320, 360);
    const below = rect.bottom + 6;
    const top = below + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 6) : below;
    el.style.top = `${top}px`;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
  };

  return {
    onStart: (props: SuggestionProps<SlashItem>) => {
      if (!props.editor.isEditable) return;
      renderer = new ReactRenderer(SlashList, {
        props: { items: props.items, command: props.command },
        editor: props.editor
      });
      document.body.appendChild(renderer.element);
      position(props);
    },
    onUpdate: (props: SuggestionProps<SlashItem>) => {
      if (!props.editor.isEditable) {
        destroy();
        return;
      }
      renderer?.updateProps({ items: props.items, command: props.command });
      position(props);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!props.view.editable) {
        destroy();
        return true;
      }
      if (props.event.key === "Escape") return false;
      return renderer?.ref?.onKeyDown(props) ?? false;
    },
    onExit: () => {
      destroy();
    }
  };
}

export type SlashCommandOptions = {
  onAiContinue?: () => void;
  isAiEnabled?: () => boolean;
};

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "shibeiSlashCommand",

  addOptions() {
    return { onAiContinue: undefined, isAiEnabled: undefined };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        allow: ({ editor }) => editor.isEditable,
        command: ({ editor, range, props }) => {
          if (editor.isEditable) props.run(editor, range);
        },
        items: ({ query }) => {
          const aiEnabled = this.options.isAiEnabled?.() ?? Boolean(this.options.onAiContinue);
          const all = buildSlashItems(aiEnabled ? this.options.onAiContinue : undefined);
          const q = query.trim().toLowerCase();
          if (!q) return all;
          return all.filter(
            (item) => item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q)
          );
        },
        render: createSlashRenderer
      })
    ];
  }
});
