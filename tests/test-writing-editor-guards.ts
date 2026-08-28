import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Editor } from "@tiptap/core";
import { buildSlashItems } from "../src/components/writing/slash-menu";

function fakeEditor(editable: boolean) {
  let mutations = 0;
  const chain = new Proxy({}, {
    get(_target, property) {
      if (property === "run") {
        return () => {
          mutations += 1;
          return true;
        };
      }
      return () => chain;
    }
  });
  return {
    editor: { isEditable: editable, chain: () => chain } as unknown as Editor,
    mutations: () => mutations
  };
}

describe("writing editor programmatic mutation guards", () => {
  test("every stale slash command is inert after the editor becomes read-only", () => {
    let aiCalls = 0;
    const locked = fakeEditor(false);
    for (const item of buildSlashItems(() => { aiCalls += 1; })) {
      item.run(locked.editor, { from: 1, to: 2 });
    }
    assert.equal(locked.mutations(), 0);
    assert.equal(aiCalls, 0);
  });

  test("commands still work while the editor is genuinely editable", () => {
    let aiCalls = 0;
    const editable = fakeEditor(true);
    const items = buildSlashItems(() => { aiCalls += 1; });
    items.find((item) => item.id === "h2")?.run(editable.editor, { from: 1, to: 2 });
    items.find((item) => item.id === "ai-continue")?.run(editable.editor, { from: 1, to: 2 });
    assert.equal(editable.mutations(), 2);
    assert.equal(aiCalls, 1);
  });
});
