import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  ensureSyntaxTree,
  forceParsing,
  syntaxTree,
} from "@codemirror/language";
import { GFM } from "@lezer/markdown";

function exhaustInitialParseBudget<T>(run: () => T): T {
  const original = Date.now;
  const base = original();
  let calls = 0;
  Date.now = () => base + 25 * calls++;
  try {
    return run();
  } finally {
    Date.now = original;
  }
}

async function fixture(t: TestContext) {
  const win = new Window({ url: "https://editor.test/?channel=partial-parse" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const api = await import("../src/editor/live-preview/plugin.ts");
  const extensions = () => [
    markdown({ extensions: GFM }),
    api.livePreviewPlugin(),
  ];
  const doc = "# Intro **strong**\n\n- [ ] Todo\n\nReading";
  const initial = exhaustInitialParseBudget(() =>
    EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: extensions(),
    }),
  );
  assert.ok(syntaxTree(initial).length < initial.doc.length);
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: initial,
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const inline = () => view.plugin(api.livePreviewViewPlugin)!.decorations;
  const blocks = () => view.state.field(api.livePreviewBlockDecorations);
  const tasks = () => {
    let count = 0;
    inline().between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget?.constructor.name === "TaskCheckboxWidget") count++;
    });
    return count;
  };
  const equivalent = () => {
    let fresh = EditorState.create({
      doc: view.state.doc,
      selection: view.state.selection,
      extensions: extensions(),
    });
    assert.ok(ensureSyntaxTree(fresh, fresh.doc.length, 1000));
    fresh = fresh.update({}).state;
    assert.equal(syntaxTree(fresh).length, fresh.doc.length);
    assert.deepEqual(
      snapshot(inline(), view.state.doc.length),
      snapshot(
        api.buildLivePreviewDecorations(fresh, false, {}, null, null),
        fresh.doc.length,
      ),
      "inline decorations equal a fresh parse and full build",
    );
    assert.deepEqual(
      snapshot(blocks(), view.state.doc.length),
      snapshot(api.buildBlockDecorations(fresh), fresh.doc.length),
      "block decorations equal a fresh parse and full build",
    );
  };
  assert.equal(tasks(), 0, "the initial tree has not reached the task item");
  return { view, inline, blocks, tasks, equivalent };
}

function snapshot(decorations: DecorationSet, length: number) {
  const values: unknown[] = [];
  decorations.between(0, length, (from, to, value) => {
    const widget = value.spec.widget;
    const fields =
      widget &&
      Object.fromEntries(
        Object.entries(widget).filter(
          ([, entry]) =>
            entry == null ||
            ["string", "number", "boolean"].includes(typeof entry),
        ),
      );
    values.push({
      from,
      to,
      class: value.spec.class,
      attributes: value.spec.attributes,
      side: value.spec.side,
      widget: widget && { type: widget.constructor.name, ...fields },
    });
  });
  return values.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

function firstLineValue(
  decorations: DecorationSet,
  state: EditorState,
  className: string,
) {
  const values: unknown[] = [];
  decorations.between(0, state.doc.line(1).to, (_from, _to, value) => {
    if (value.spec.class === className) values.push(value);
  });
  assert.equal(values.length, 1, `one first-line ${className} decoration`);
  return values[0];
}

test("a local edit that completes a partial parse immediately refreshes task widgets", async (t) => {
  const { view, tasks, equivalent } = await fixture(t);
  view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
  assert.equal(syntaxTree(view.state).length, view.state.doc.length);
  assert.equal(
    tasks(),
    1,
    "completed parsing must refresh cached task markers",
  );
  assert.equal(
    view.contentDOM.querySelectorAll('input[type="checkbox"]').length,
    1,
  );
  equivalent();
});

test("unchanged partial coverage keeps local decoration identities and later parsing recovers tasks", async (t) => {
  const { view, inline, blocks, tasks, equivalent } = await fixture(t);
  const coverage = syntaxTree(view.state).length;
  const heading = firstLineValue(blocks(), view.state, "zmd-lp-h1");
  const strong = firstLineValue(inline(), view.state, "zmd-lp-strong");
  const changes = view.state.changes({
    from: view.state.doc.length,
    insert: "!",
  });
  exhaustInitialParseBudget(() => view.dispatch({ changes }));
  assert.equal(syntaxTree(view.state).length, changes.mapPos(coverage));
  assert.ok(syntaxTree(view.state).length < view.state.doc.length);
  assert.equal(firstLineValue(blocks(), view.state, "zmd-lp-h1"), heading);
  assert.equal(firstLineValue(inline(), view.state, "zmd-lp-strong"), strong);
  assert.equal(tasks(), 0, "tasks wait for parsing to reach their source");
  assert.equal(forceParsing(view, view.state.doc.length, 1000), true);
  assert.equal(tasks(), 1);
  assert.equal(
    view.contentDOM.querySelectorAll('input[type="checkbox"]').length,
    1,
  );
  equivalent();
});
