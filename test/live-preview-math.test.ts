import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { GFM } from "@lezer/markdown";

async function editor(t: TestContext, source: string, anchor = source.length) {
  const win = new Window({ url: "https://editor.test/?channel=math" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const api = await import("../src/editor/live-preview/plugin.ts");
  const parent = win.document.createElement("div");
  win.document.body.append(parent);
  const errors: unknown[] = [];
  let dispatches = 0;
  const state = EditorState.create({
    doc: source,
    selection: { anchor },
    extensions: [
      markdown({ extensions: GFM }),
      history(),
      api.livePreviewPlugin(),
      EditorView.exceptionSink.of((error) => errors.push(error)),
    ],
  });
  ensureSyntaxTree(state, source.length, 5000);
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: state.update({}).state,
    dispatchTransactions(transactions, current) {
      dispatches++;
      current.update(transactions);
    },
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.deepEqual(errors, [], "no asynchronous editor/plugin exceptions");
  });
  return { view, win, api, dispatches: () => dispatches };
}

test("Live renders the actual numbered and short bracket formulas in body and lists", async (t) => {
  const source = [
    String.raw`\(\sigma_{c}^{*}=\frac{2 \sum_{s}^{*}}{\Lambda} \tag{1}\)`,
    String.raw`- \(\sigma_c^*\)`,
    String.raw`- \(\mathrm{S/m}\)`,
    String.raw`\(\nabla \cdot[\sigma^*(x,y,z,\omega)\nabla V^*(x,y,z,\omega)]=-I^*(\omega)\delta(r-r') \tag{3}\)`,
    "End",
  ].join("\n\n");
  const { view } = await editor(t, source);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math math").length, 4);
  assert.equal(view.dom.querySelectorAll('math[display="block"]').length, 2);
  assert.equal(view.dom.querySelectorAll(".katex-error").length, 0);
  assert.equal(
    view.dom.querySelectorAll(".zmd-lp-em").length,
    0,
    "TeX stars do not become emphasis",
  );
});

test("Live renders all delimiters, multiline display and multiline inline spans", async (t) => {
  const source = [
    "$x^2$",
    "$$x^2$$",
    String.raw`\(x^2\)`,
    String.raw`\[x^2\]`,
    "$$\n\\frac{1}{2}\n$$",
    "\\[\n\\sum_i i\n\\]",
    "Before \\(x +\ny\\) after",
    "$x +\ny$",
    "End",
  ].join("\n\n");
  const { view } = await editor(t, source);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math math").length, 8);
  assert.equal(view.dom.querySelectorAll(".katex-error").length, 0);
  assert.match(view.contentDOM.textContent || "", /Before/);
  assert.match(view.contentDOM.textContent || "", /after/);
});

test("normal fences, indentation and inline code remain literal in Live", async (t) => {
  const source =
    "`$x$` and `\\(x\\)`\n\n```tex\n\\[x\\]\n$x$\n```\n\n    \\(x\\)\n\nEnd";
  const { view } = await editor(t, source);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math").length, 0);
  assert.match(view.contentDOM.textContent || "", /\$x\$/);
});

test("math delimiters in link targets and reference destinations remain URLs", async (t) => {
  const { view } = await editor(
    t,
    "[file](https://example.test/$name$)\n\n[ref]: https://example.test/$x$\n\nEnd",
  );
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math").length, 0);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-link").length, 1);
});

test("click reveals math source; edits, leaving the line, undo and shifted offsets stay current", async (t) => {
  const source = "Intro\n\n\\(x^2\\)\n\nEnd";
  const { view, win } = await editor(t, source);
  let widget = view.dom.querySelector<HTMLElement>(".zmd-lp-math")!;
  assert.ok(widget);
  widget.dispatchEvent(
    new win.MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
    }) as unknown as Event,
  );
  assert.equal(view.state.selection.main.head, source.indexOf("x^2"));
  assert.equal(view.dom.querySelector(".zmd-lp-math"), null);
  assert.match(view.contentDOM.textContent || "", /\\\(x\^2\\\)/);
  const at = source.indexOf("2");
  view.dispatch({ changes: { from: at, to: at + 1, insert: "3" } });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(view.dom.querySelector("annotation")?.textContent || "", /x\^3/);
  assert.ok(undo(view));
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.match(view.dom.querySelector("annotation")?.textContent || "", /x\^2/);
  view.dispatch({ changes: { from: 0, insert: "AAAA" } });
  widget = view.dom.querySelector<HTMLElement>(".zmd-lp-math")!;
  assert.equal(Number(widget.dataset.zmdMathFrom), source.indexOf("\\(") + 4);
  widget.dispatchEvent(
    new win.MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
    }) as unknown as Event,
  );
  assert.equal(view.state.selection.main.head, source.indexOf("x^2") + 4);
});

test("a selection anywhere in a multiline formula keeps the whole source editable", async (t) => {
  const source = "\\[\n\\frac{1}{2}\n\\]\n\nEnd";
  const { view } = await editor(t, source);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math").length, 1);
  view.dispatch({ selection: { anchor: source.indexOf("frac") } });
  assert.equal(view.dom.querySelector(".zmd-lp-math"), null);
  assert.match(view.contentDOM.textContent || "", /\\frac\{1\}\{2\}/);
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  assert.equal(view.dom.querySelectorAll(".zmd-lp-math math").length, 1);
});

test("table cells render inline math without replacing the table's owned editor DOM", async (t) => {
  const { view } = await editor(
    t,
    "| Symbol | Value |\n| --- | --- |\n| \\(x^2\\) | $y$ |\n\nEnd",
  );
  assert.equal(view.dom.querySelectorAll(".zmd-lp-table-cell math").length, 2);
  assert.equal(view.dom.querySelectorAll(".zmd-lp-table-row").length, 2);
});

test("formula editing preserves the final pending native composition mutation", async (t) => {
  const source = "# \\(n\\)\n\nEnd";
  const { view, win, api, dispatches } = await editor(
    t,
    source,
    source.indexOf("n") + 1,
  );
  view.focus();
  const before = dispatches();
  const line = view.contentDOM.firstChild;
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionstart", {
      bubbles: true,
    }) as unknown as Event,
  );
  assert.equal(
    api.livePreviewViewPlugin &&
      view.plugin(api.livePreviewViewPlugin)?.composing,
    true,
  );
  assert.equal(dispatches(), before);
  assert.equal(view.contentDOM.firstChild, line);
  const node = win.document.getSelection()?.focusNode;
  assert.ok(node && node.nodeType === 3);
  assert.match(node.nodeValue || "", /n/);
  node.nodeValue = node.nodeValue!.replace("n", "中");
  assert.equal(
    view.state.doc.toString(),
    source,
    "DOM mutation is still pending",
  );
  view.contentDOM.dispatchEvent(
    new win.CompositionEvent("compositionend", {
      bubbles: true,
    }) as unknown as Event,
  );
  await Promise.resolve();
  assert.equal(view.state.doc.toString(), source.replace("n", "中"));
  assert.equal(win.document.getSelection()?.focusNode, node);
  assert.equal(node.isConnected, true);
  assert.equal(view.dom.querySelector(".zmd-lp-math"), null);
});

test("a 10k-line math document keeps ordinary edits local and formula edits equal to a fresh build", async (t) => {
  const source =
    "# Heading\n\n" +
    Array.from({ length: 10000 }, (_, index) =>
      index % 50 === 0 ? `\\(x_{${index}}^2\\)` : `ordinary paragraph ${index}`,
    ).join("\n") +
    "\n\nEnd";
  const { view, api } = await editor(t, source);
  const headingDecoration = view.state
    .field(api.livePreviewBlockDecorations)
    .iter().value;
  const plainStart = performance.now();
  view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
  const plainMs = performance.now() - plainStart;
  assert.equal(
    view.state.field(api.livePreviewBlockDecorations).iter().value,
    headingDecoration,
    "an ordinary edit preserves the cached heading Decoration",
  );
  const at =
    view.state.doc.toString().indexOf("x_{5000}^2") + "x_{5000}^".length;
  const mathStart = performance.now();
  view.dispatch({ changes: { from: at, to: at + 1, insert: "3" } });
  const mathMs = performance.now() - mathStart;
  assert.equal(
    view.state.field(api.livePreviewBlockDecorations).iter().value,
    headingDecoration,
    "a pure number edit inside a single-line equation preserves the structural cache",
  );
  const current = view.state.doc.toString();
  const fresh = EditorState.create({
    doc: current,
    selection: view.state.selection,
    extensions: [markdown({ extensions: GFM }), api.livePreviewPlugin()],
  });
  ensureSyntaxTree(fresh, current.length, 5000);
  const complete = fresh.update({}).state;
  const values = (state: EditorState) => {
    const ranges: unknown[] = [];
    state
      .field(api.livePreviewMathDecorations)
      .between(0, state.doc.length, (from, to, value) => {
        const formula = value.spec.widget?.formula;
        ranges.push({
          from,
          to,
          tex: formula?.content,
          display: formula?.display,
        });
      });
    return ranges;
  };
  assert.deepEqual(values(view.state), values(complete));
  assert.equal(values(view.state).length, 200);
  assert.ok(
    values(view.state).some(
      (range) => (range as { tex: string }).tex === "x_{5000}^3",
    ),
  );
  t.diagnostic(
    `10k lines / 200 equations, Node + Happy DOM: ordinary input ${plainMs.toFixed(2)}ms; formula input ${mathMs.toFixed(2)}ms (includes view update, excludes initial load).`,
  );
});
