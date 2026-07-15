import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdminMarkdownWorkspace,
  markdownWorkspaceDialogA11y,
  markdownWorkspaceModeA11y
} from "../src/components/AdminMarkdownWorkspace";
import { countMarkdownText, formatMarkdownSelection } from "../src/lib/admin-markdown-editor";

describe("admin Markdown editor toolbar", () => {
  test("wraps only the selected text and preserves the rest of the article", () => {
    const source = "前文\n关键事实\n后文";
    const start = source.indexOf("关键");
    const result = formatMarkdownSelection(source, start, start + 4, "bold");
    assert.equal(result.value, "前文\n**关键事实**\n后文");
    assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "关键事实");
  });

  test("prefixes every selected line for lists without dropping prose", () => {
    const source = "导语\n甲\n乙\n结语";
    const result = formatMarkdownSelection(source, source.indexOf("甲"), source.indexOf("乙") + 1, "bullet");
    assert.equal(result.value, "导语\n- 甲\n- 乙\n结语");
  });

  test("inserts readable placeholders when nothing is selected", () => {
    const result = formatMarkdownSelection("正文", 2, 2, "link");
    assert.equal(result.value, "正文[链接文字](https://)");
    assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "链接文字");
  });

  test("a divider never deletes selected source text", () => {
    const result = formatMarkdownSelection("第一段\n第二段", 0, 3, "divider");
    assert.equal(result.value, "第一段\n\n---\n\n第二段");
  });

  test("reports Unicode characters and physical lines", () => {
    assert.deepEqual(countMarkdownText("韩国股市\nKOSPI"), { characters: 10, lines: 2 });
  });
});

describe("admin Markdown editor accessibility", () => {
  test("uses ordinary pressed buttons for the segmented view control", () => {
    const html = renderToStaticMarkup(createElement(AdminMarkdownWorkspace, {
      id: "article-content",
      name: "content",
      initialValue: "## 正文",
      label: "文章正文"
    }));

    assert.match(html, /role="group"[^>]*aria-label="编辑器视图"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="article-content-markdown-workspace-/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /role="tab(list)?"/);
    assert.doesNotMatch(html, /aria-selected=/);
  });

  test("removes the hidden source from Tab order and disables formatting in preview-only mode", () => {
    assert.deepEqual(markdownWorkspaceModeA11y("preview"), {
      sourceAriaHidden: true,
      sourceTabIndex: -1,
      formatActionsDisabled: true
    });
    assert.deepEqual(markdownWorkspaceModeA11y("edit"), {
      sourceAriaHidden: false,
      sourceTabIndex: undefined,
      formatActionsDisabled: false
    });
  });

  test("adds complete modal dialog semantics only while focus mode is open", () => {
    assert.deepEqual(markdownWorkspaceDialogA11y(true), {
      role: "dialog",
      "aria-modal": true,
      tabIndex: -1
    });
    assert.deepEqual(markdownWorkspaceDialogA11y(false), {
      role: undefined,
      "aria-modal": undefined,
      tabIndex: undefined
    });
  });
});
