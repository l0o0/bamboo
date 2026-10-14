import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { cachedLineParse } from "../src/editor/live-preview/line-cache.ts";

async function fixture(t: TestContext, doc: string) {
  const win = new Window({ url: "https://editor.test/?channel=visible-links" });
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
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
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
  return { api, view, win, extensions };
}

function snapshot(decorations: DecorationSet, length: number) {
  const result: { from: number; to: number; kind: string; marker?: string }[] =
    [];
  decorations.between(0, length, (from, to, value) =>
    result.push({
      from,
      to,
      kind: value.spec.class ?? "replace",
      ...(value.spec.attributes?.["data-zmd-link"] !== undefined
        ? { marker: value.spec.attributes["data-zmd-link"] }
        : {}),
    }),
  );
  return result;
}

function visibleLine(state: EditorState, number: number) {
  const line = state.doc.line(number);
  return [{ from: line.from, to: line.to }];
}

test("only visible links and their syntax markers are painted, with no href in DOM attributes", async (t) => {
  const source = Array.from(
    { length: 80 },
    (_, index) => `[Link ${index}](https://example.test/${index})`,
  ).join("\n\n");
  const { api, view } = await fixture(t, source);
  const ranges = visibleLine(view.state, 3);
  const paint = snapshot(
    api.buildVisibleLinkDecorations(view.state, ranges),
    source.length,
  );
  assert.equal(paint.length, 3);
  assert.equal(paint.filter((range) => range.kind === "zmd-lp-link").length, 1);
  assert.equal(paint.find((range) => range.kind === "zmd-lp-link")?.marker, "");
  assert.ok(
    paint.every(
      (range) => range.from >= ranges[0]!.from && range.to <= ranges[0]!.to,
    ),
  );
  const documentPaint = snapshot(
    view.plugin(api.livePreviewViewPlugin)!.decorations,
    source.length,
  );
  assert.equal(
    documentPaint.length,
    0,
    "offscreen links have neither global style nor global syntax replacements",
  );
});

test("scroll updates only the link plugin and reuses cached line parsing", async (t) => {
  const source =
    "[First](https://one.test)\n\nPlain **bold** paragraph\n\n[Last](https://two.test)\n\nEnd";
  const { api, view } = await fixture(t, source);
  let visible = visibleLine(view.state, 1);
  Object.defineProperty(view, "visibleRanges", {
    configurable: true,
    get: () => visible,
  });
  const plugin = view.plugin(api.livePreviewVisibleLinks)!;
  const structural = view.state.field(api.livePreviewBlockDecorations);
  const documentPaint = view.plugin(api.livePreviewViewPlugin)!.decorations;
  const cached = cachedLineParse(view.state.doc.line(1).text, false);
  const scroll = () =>
    plugin.update({
      view,
      state: view.state,
      startState: view.state,
      viewportChanged: true,
    } as ViewUpdate);
  scroll();
  assert.equal(
    snapshot(plugin.decorations, source.length).find(
      (range) => range.kind === "zmd-lp-link",
    )?.from,
    1,
  );
  visible = visibleLine(view.state, 5);
  scroll();
  assert.equal(
    snapshot(plugin.decorations, source.length).find(
      (range) => range.kind === "zmd-lp-link",
    )?.from,
    view.state.doc.line(5).from + 1,
  );
  visible = visibleLine(view.state, 1);
  scroll();
  assert.equal(cachedLineParse(view.state.doc.line(1).text, false), cached);
  assert.equal(view.state.field(api.livePreviewBlockDecorations), structural);
  assert.equal(
    view.plugin(api.livePreviewViewPlugin)!.decorations,
    documentPaint,
  );
});

test("a clipped long line paints intersecting links only and never hides a newline", async (t) => {
  const source = Array.from(
    { length: 120 },
    (_, index) => `[label${index}](https://example.test/${index})`,
  ).join(" ");
  const { api, view } = await fixture(t, source);
  const first = snapshot(
    api.buildVisibleLinkDecorations(view.state, [{ from: 0, to: 12 }]),
    source.length,
  );
  assert.equal(first.length, 3);
  assert.equal(first.filter((range) => range.kind === "zmd-lp-link").length, 1);
  const start = source.indexOf("[label70]");
  const middle = snapshot(
    api.buildVisibleLinkDecorations(view.state, [
      { from: start, to: start + 8 },
    ]),
    source.length,
  );
  assert.equal(middle.length, 3);
  assert.ok(
    middle.every((range) => !source.slice(range.from, range.to).includes("\n")),
  );
  assert.equal(
    middle.find((range) => range.kind === "zmd-lp-link")?.from,
    start + 1,
  );
});

test("code, HTML, frontmatter, image and table ranges keep their existing rendering owner", async (t) => {
  const source = [
    "---",
    "title: '[front](https://front.test)'",
    "---",
    "",
    "`[code](https://code.test)`",
    "",
    "```md",
    "[fence](https://fence.test)",
    "```",
    "",
    "    [indented](https://indent.test)",
    "",
    '<div title="[attribute](https://attr.test)">',
    "[html](https://html.test)",
    "</div>",
    "",
    "![image](https://image.test/a.png)",
    "",
    "| A | B |",
    "| - | - |",
    "| [cell](https://cell.test) | b |",
    "",
    "[visible](https://visible.test)",
    "",
    "End",
  ].join("\n");
  const { api, view } = await fixture(t, source);
  const paint = snapshot(
    api.buildVisibleLinkDecorations(view.state, [
      { from: 0, to: source.length },
    ]),
    source.length,
  );
  const links = paint.filter((range) => range.kind === "zmd-lp-link");
  assert.equal(links.length, 1);
  assert.equal(source.slice(links[0]!.from, links[0]!.to), "visible");
  assert.ok(
    view.plugin(api.livePreviewViewPlugin)!.decorations.size > 0,
    "table and image decorations stay with the document-wide renderer",
  );
});

test("active lines and IME expose link syntax, while multiline link source stays literal", async (t) => {
  const source =
    "[First](https://one.test)\n[Second](https://two.test)\n\n[multi\nline](https://multi.test)\n\nEnd";
  const { api, view } = await fixture(t, source);
  const second = view.state.doc.line(2);
  view.dispatch({ selection: { anchor: 0, head: second.from } });
  const inactive = snapshot(
    api.buildVisibleLinkDecorations(
      view.state,
      visibleLine(view.state, 2),
      false,
    ),
    source.length,
  );
  const composing = snapshot(
    api.buildVisibleLinkDecorations(
      view.state,
      visibleLine(view.state, 2),
      true,
    ),
    source.length,
  );
  assert.equal(inactive.filter((range) => range.kind === "replace").length, 2);
  assert.equal(
    composing.filter((range) => range.kind === "zmd-lp-syntax").length,
    2,
  );
  const multiline = snapshot(
    api.buildVisibleLinkDecorations(view.state, [
      { from: view.state.doc.line(4).from, to: view.state.doc.line(5).to },
    ]),
    source.length,
  );
  assert.deepEqual(multiline, []);
});

test("document and selection updates keep visible link paint equal to a fresh state", async (t) => {
  const source =
    "Paragraph\n\n[First](https://one.test) and [[Second|Alias]]\n\nEnd";
  const { api, view, extensions } = await fixture(t, source);
  for (let index = 0; index < 20; index += 1) {
    view.dispatch({ changes: { from: 3, insert: "x" } });
    view.dispatch({
      selection: {
        anchor: index % 2 ? view.state.doc.line(3).from : view.state.doc.length,
      },
    });
    const fresh = EditorState.create({
      doc: view.state.doc,
      selection: view.state.selection,
      extensions: extensions(),
    });
    assert.deepEqual(
      snapshot(
        view.plugin(api.livePreviewVisibleLinks)!.decorations,
        view.state.doc.length,
      ),
      snapshot(
        api.buildVisibleLinkDecorations(fresh, view.visibleRanges),
        fresh.doc.length,
      ),
    );
    for (const marker of view.dom.querySelectorAll("[data-zmd-link]"))
      assert.equal(marker.getAttribute("data-zmd-link"), "");
  }
});

test("syntax completion refreshes visible link paint after an initially partial parse", async (t) => {
  const source =
    Array.from(
      { length: 1000 },
      (_, index) => `[Link${index}](https://example.test/${index})\n`,
    ).join("\n") + "\nEnd";
  const { api, view } = await fixture(t, source);
  const last = view.state.doc.line(view.state.doc.lines - 2);
  Object.defineProperty(view, "visibleRanges", {
    configurable: true,
    get: () => [{ from: last.from, to: last.to }],
  });
  const plugin = view.plugin(api.livePreviewVisibleLinks)!;
  plugin.update({
    view,
    state: view.state,
    startState: view.state,
    viewportChanged: true,
  } as ViewUpdate);
  const before = syntaxTree(view.state).length;
  assert.ok(before < last.from, "the distant link has not been parsed yet");
  assert.equal(plugin.decorations.size, 0);
  assert.ok(forceParsing(view, view.state.doc.length, 1000));
  assert.equal(
    snapshot(plugin.decorations, source.length).filter(
      (range) => range.kind === "zmd-lp-link",
    ).length,
    1,
  );
  assert.ok(syntaxTree(view.state).length >= before);
});
