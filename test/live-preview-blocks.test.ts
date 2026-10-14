import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo, redo } from "@codemirror/commands";
import { GFM } from "@lezer/markdown";
import {
  liveBlockMarkers,
  TaskCheckboxWidget,
} from "../src/editor/live-preview/blocks.ts";
import { frontmatterLineNumbersFromLines } from "../src/editor/live-preview/active-lines.ts";

function state(doc: string) {
  const current = EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM }), history()],
  });
  // The default 20ms initialization budget may yield under concurrent tests.
  assert.ok(ensureSyntaxTree(current, current.doc.length, 5000));
  return current.update({}).state;
}

test("recognizes real task items and rules without treating code or Setext headings as rules", () => {
  const doc =
    "Heading\n---\n\n***\n\n- [ ] Todo\n  - [X] Done\n\n```md\n- [ ] Code\n***\n```\n\n    - [ ] Indented code\n\n\\***";
  const markers = liveBlockMarkers(state(doc));
  assert.deepEqual([...markers.rules.keys()], [4]);
  assert.deepEqual([...markers.tasks.keys()], [6, 7]);
  assert.deepEqual(
    [...markers.tasks.values()].map(({ from, to }) => doc.slice(from, to)),
    ["[ ]", "[X]"],
  );
});

test("frontmatter protects both delimiters from horizontal-rule decorations", () => {
  assert.deepEqual(
    [...frontmatterLineNumbersFromLines(["---", "title: Note", "---", "***"])],
    [1, 2, 3],
  );
  assert.equal(frontmatterLineNumbersFromLines(["---", "plain text"]).size, 0);
});

test("checkbox edits only its marker and supports undo/redo without moving the reading cursor", () => {
  const browser = new Window();
  let current = state("- [ ] Todo\n\nReading");
  current = current.update({ selection: { anchor: current.doc.length } }).state;
  const view = {
    dom: browser.document.createElement("div"),
    get state() {
      return current;
    },
    dispatch(transaction: any) {
      current = transaction.state || current.update(transaction).state;
    },
  };
  const input = new TaskCheckboxWidget(2, false, "Todo", false).toDOM(
    view as unknown as EditorView,
  );
  input.checked = true;
  input.dispatchEvent(new browser.Event("change"));
  assert.equal(current.doc.toString(), "- [x] Todo\n\nReading");
  assert.equal(current.selection.main.head, current.doc.length);
  assert.ok(undo(view));
  assert.equal(current.doc.toString(), "- [ ] Todo\n\nReading");
  assert.ok(redo(view));
  assert.equal(current.doc.toString(), "- [x] Todo\n\nReading");
  browser.close();
});

test("checkbox refuses read-only edits", () => {
  const browser = new Window();
  const current = EditorState.create({
    doc: "- [ ] Todo",
    extensions: EditorState.readOnly.of(true),
  });
  const view = {
    dom: browser.document.createElement("div"),
    state: current,
    dispatch() {
      assert.fail("read-only edit");
    },
  };
  const input = new TaskCheckboxWidget(2, false, "Todo", true).toDOM(
    view as unknown as EditorView,
  );
  assert.equal(input.disabled, true);
  input.dispatchEvent(new browser.Event("change"));
  browser.close();
});
