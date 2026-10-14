import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState, StateEffect } from "@codemirror/state";
import { ensureSyntaxTree, forceParsing } from "@codemirror/language";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { history, undo, redo } from "@codemirror/commands";

async function fixture(t: TestContext, doc: string) {
  const win = new Window({ url: "https://editor.test/?channel=incremental" });
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
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const extensions = () => [
    markdown({ extensions: GFM }),
    history(),
    api.livePreviewPlugin(),
  ];
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: extensions(),
    }),
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const equivalent = () => {
    // Compare completed parses, not whichever partial tree fits the default
    // 20ms budget while other test processes are using the host CPU.
    assert.ok(forceParsing(view, view.state.doc.length, 5000));
    const current = view.plugin(api.livePreviewViewPlugin)!;
    let fresh = EditorState.create({
      doc: view.state.doc,
      selection: view.state.selection,
      extensions: [
        ...extensions(),
        EditorState.readOnly.of(view.state.readOnly),
      ],
    });
    assert.ok(ensureSyntaxTree(fresh, fresh.doc.length, 5000));
    fresh = fresh.update({}).state;
    assert.deepEqual(
      snapshot(current.decorations, view.state.doc.length),
      snapshot(
        api.buildLivePreviewDecorations(
          fresh,
          current.composing,
          current.imageAssets,
          current.activeCell,
          current.tableSelection,
        ),
        fresh.doc.length,
      ),
      "incremental inline decorations equal a fresh full rebuild",
    );
    assert.deepEqual(
      snapshot(
        view.state.field(api.livePreviewBlockDecorations),
        view.state.doc.length,
      ),
      snapshot(api.buildBlockDecorations(fresh), fresh.doc.length),
      "incremental block decorations equal a fresh full rebuild",
    );
  };
  return { view, api, win, equivalent };
}

function snapshot(decorations: DecorationSet, length: number) {
  const values: unknown[] = [];
  decorations.between(0, length, (from, to, value) => {
    const widget = value.spec.widget;
    const fields =
      widget &&
      Object.fromEntries(
        Object.entries(widget).filter(
          ([key, entry]) =>
            key !== "railResizeObserver" &&
            (entry == null ||
              ["string", "number", "boolean"].includes(typeof entry)),
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

test("local edits, cursor changes and multi-range input remain equal to a full rebuild", async (t) => {
  const source = [
    "# Heading",
    "",
    "Paragraph with **bold** and a [link](https://example.test).",
    "Second ordinary paragraph with *italic* text.",
    "",
    "- [ ] A task",
    "",
    "![Figure][ref]",
    "",
    "[ref]: assets/a.png",
    "",
    "| A | B |",
    "| - | - |",
    "| one | two |",
    "",
    "```js",
    "const value = 1;",
    "```",
    "",
    "Tail paragraph with ~plain~ text.",
  ].join("\n");
  const { view, equivalent } = await fixture(t, source);
  equivalent();
  let seed = 31;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let index = 0; index < 150; index++) {
    const a = view.state.doc.line(3),
      b = view.state.doc.line(4);
    const fromA = a.from + Math.min(15, a.length),
      fromB = b.from + Math.min(12, b.length);
    view.dispatch({
      changes:
        index % 3
          ? {
              from: fromA,
              to: fromA + (index % 2),
              insert: index % 2 ? "" : "x",
            }
          : [
              { from: fromA, insert: "z" },
              { from: fromB, insert: "y" },
            ],
    });
    equivalent();
    view.dispatch({ selection: { anchor: random(view.state.doc.length + 1) } });
    equivalent();
  }
});

test("structural edits, definitions, code, table cells and undo/redo use correct invalidation", async (t) => {
  const source =
    "Ordinary paragraph\n\n![Figure][ref]\n\n[ref]: assets/a.png\n\n| A | B |\n| - | - |\n| one | two |\n\n```js\nconst value = 1;\n```\n\nEnd";
  const { view, api, equivalent } = await fixture(t, source);
  const edits = [
    () => ({ from: 0, insert: "# " }),
    () => ({
      from: view.state.doc.toString().indexOf("assets/a.png"),
      to: view.state.doc.toString().indexOf("assets/a.png") + 12,
      insert: "assets/b.gif",
    }),
    () => ({
      from: view.state.doc.toString().indexOf("one"),
      to: view.state.doc.toString().indexOf("one") + 3,
      insert: "**three**",
    }),
    () => ({
      from: view.state.doc.toString().indexOf("const"),
      insert: "// comment\n",
    }),
    () => ({ from: view.state.doc.length, insert: "\n\n***\n\n- [x] Task" }),
  ];
  for (const edit of edits) {
    view.dispatch({ changes: edit() });
    equivalent();
  }
  view.dispatch({
    effects: api.setLiveTableSelection.of({
      kind: "column",
      tableFrom: view.state.doc.toString().indexOf("| A"),
      columnIndex: 1,
    }),
  });
  equivalent();
  view.dispatch({ effects: api.setLiveTableSelection.of(null) });
  equivalent();
  for (let index = 0; index < edits.length; index++) {
    assert.ok(undo(view));
    equivalent();
  }
  for (let index = 0; index < edits.length; index++) {
    assert.ok(redo(view));
    equivalent();
  }
});

test("single image updates and mapped later interactive widgets keep exact source positions", async (t) => {
  const source =
    "Ordinary paragraph\n\n![Figure](assets/a.png)\n\n- [ ] Task\n\n| A | B |\n| - | - |\n| one | two |\n\nEnd";
  const { view, api, equivalent } = await fixture(t, source);
  view.dispatch({
    effects: api.setLiveImageAssets.of({
      "assets/a.png": { dataUrl: "data:image/png;base64,eA==" },
    }),
  });
  equivalent();
  const plugin = view.plugin(api.livePreviewViewPlugin)!;
  let imageWidget: unknown;
  plugin.decorations.between(0, view.state.doc.length, (_from, _to, value) => {
    if (value.spec.widget?.constructor.name === "ImageWidget")
      imageWidget = value.spec.widget;
  });
  view.dispatch({ selection: { anchor: view.state.doc.length - 1 } });
  let unchanged: unknown;
  plugin.decorations.between(0, view.state.doc.length, (_from, _to, value) => {
    if (value.spec.widget?.constructor.name === "ImageWidget")
      unchanged = value.spec.widget;
  });
  assert.equal(
    unchanged,
    imageWidget,
    "unrelated cursor motion retains the image widget",
  );
  view.dispatch({ changes: { from: 5, insert: " shifted" } });
  equivalent();
  const image = view.dom.querySelector<HTMLElement>(".zmd-lp-image");
  assert.equal(
    image?.dataset.zmdImageFrom,
    String(view.state.doc.toString().indexOf("![Figure]")),
  );
  view.dispatch({
    effects: api.setLiveImageAssets.of({
      "assets/a.png": { dataUrl: "data:image/png;base64,eQ==" },
    }),
  });
  equivalent();
});

test("IME composing transitions preserve the full-build decoration result", async (t) => {
  const { view, win, api, equivalent } = await fixture(
    t,
    "First **bold** paragraph.\n\nSecond paragraph.",
  );
  view.focus();
  view.dispatch({ selection: { anchor: 8 } });
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionstart", { bubbles: true }),
  );
  assert.equal(view.plugin(api.livePreviewViewPlugin)?.composing, true);
  equivalent();
  view.dispatch({
    changes: { from: 8, insert: "中文" },
    selection: { anchor: 10 },
  });
  equivalent();
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionend", { bubbles: true }),
  );
  equivalent();
});

test("read-only changes rebuild table and task controls consistently", async (t) => {
  const { view, equivalent } = await fixture(
    t,
    "- [ ] Task\n\n| A | B |\n| - | - |\n| one | two |\n\nEnd",
  );
  view.dispatch({
    effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
  });
  equivalent();
  assert.equal(
    view.dom.querySelector<HTMLInputElement>(".zmd-lp-task-checkbox")?.disabled,
    true,
  );
  assert.equal(
    view.dom.querySelectorAll(".zmd-lp-table-edge-action").length,
    0,
  );
});

test("reference definition continuation changes invalidate every referring image", async (t) => {
  const source = "![Figure][ref]\n\n[ref]:\n  assets/a.png\n\nEnd";
  const { view, equivalent } = await fixture(t, source);
  const from = source.indexOf("a.png");
  view.dispatch({ changes: { from, to: from + 1, insert: "b" } });
  equivalent();
  assert.ok(undo(view));
  equivalent();
});

test("HTML block and comment boundaries invalidate later task structure", async (t) => {
  for (const opening of ["<div>", "<!--"]) {
    const source = "Ordinary paragraph\n- [ ] Task\n\nTail";
    const { view, equivalent } = await fixture(t, source);
    view.dispatch({
      changes: { from: 0, to: "Ordinary paragraph".length, insert: opening },
    });
    equivalent();
    assert.equal(view.dom.querySelectorAll(".zmd-lp-task-checkbox").length, 0);
    assert.ok(undo(view));
    equivalent();
    view.destroy();
  }
});

test("edits before a remote image update both decoration and widget source offsets", async (t) => {
  const source = "Paragraph\n\n![x](https://example.test/a.png)\n\nEnd";
  const { view, equivalent } = await fixture(t, source);
  view.dispatch({ changes: { from: 3, insert: "AAAA" } });
  equivalent();
  const image = view.dom.querySelector<HTMLElement>(".zmd-lp-image");
  assert.equal(
    image?.dataset.zmdImageFrom,
    String(view.state.doc.toString().indexOf("![x]")),
  );
  assert.equal(
    image?.dataset.zmdImageTo,
    String(view.state.doc.toString().indexOf(")\n\nEnd") + 1),
  );
});
