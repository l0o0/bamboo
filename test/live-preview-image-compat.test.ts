import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { GFM } from "@lezer/markdown";
import { imageControls } from "../src/editor/image-controls.ts";
import { editorTableLabels } from "../src/editor/table-config.ts";

const PNG = "data:image/png;base64,aGVsbG8=";
const GIF = "data:image/gif;base64,aGVsbG8=";

async function editor(t: TestContext, source: string) {
  const win = new Window({ url: "https://editor.test/?channel=images" });
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
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const { livePreviewPlugin, setLiveImageAssets } =
    await import("../src/editor/live-preview/plugin.ts");
  const view = new EditorView({
    parent: host as unknown as HTMLElement,
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [
        markdown({ extensions: GFM }),
        history(),
        livePreviewPlugin(),
        imageControls(),
        editorTableLabels.of({ "append-column": "新增列测试" }),
      ],
    }),
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { view, win, setLiveImageAssets };
}

function visibleImages(view: EditorView) {
  return Array.from(
    view.dom.querySelectorAll<HTMLImageElement>(".zmd-lp-image img"),
  );
}

test("Live resolves cross-line definitions and refreshes a picture when its definition changes", async (t) => {
  const source = "![Figure][REF]\n\n[ref]: assets/a.png\n\nEnd";
  const { view, setLiveImageAssets } = await editor(t, source);
  view.dispatch({
    effects: setLiveImageAssets.of({
      "assets/a.png": { dataUrl: PNG },
      "assets/b.gif": { dataUrl: GIF },
    }),
  });
  assert.equal(visibleImages(view)[0]?.getAttribute("src"), PNG);
  const from = source.indexOf("assets/a.png");
  view.dispatch({
    changes: { from, to: from + "assets/a.png".length, insert: "assets/b.gif" },
  });
  assert.equal(visibleImages(view)[0]?.getAttribute("src"), GIF);
  assert.equal(visibleImages(view)[0]?.alt, "Figure");
  assert.ok(undo(view));
  assert.equal(visibleImages(view)[0]?.getAttribute("src"), PNG);
});

test("Wiki images render in Live with their own width and URI-safe resolved assets", async (t) => {
  const { view, setLiveImageAssets } = await editor(
    t,
    "![[my%20image.png|320]]\n\nEnd",
  );
  view.dispatch({
    effects: setLiveImageAssets.of({
      "assets/my%20image.png": { error: "Missing literal file" },
      "assets/my image.png": { dataUrl: PNG },
    }),
  });
  const image = visibleImages(view)[0];
  assert.ok(image);
  assert.equal(image.getAttribute("src"), PNG);
  assert.equal(image.getAttribute("width"), "320");
  const wrapper = image.closest<HTMLElement>(".zmd-lp-image");
  assert.equal(wrapper?.dataset.zmdImageFrom, "0");
  assert.equal(
    wrapper?.dataset.zmdImageTo,
    String("![[my%20image.png|320]]".length),
  );
});

test("Live reference definitions ignore frontmatter and preserve real document offsets", async (t) => {
  const source =
    "---\n[ref]: assets/a.png\n---\n\n![Figure][ref]\n\n[ref]: assets/b.gif\n\nEnd";
  const { view, setLiveImageAssets } = await editor(t, source);
  view.dispatch({
    effects: setLiveImageAssets.of({
      "assets/a.png": { dataUrl: PNG },
      "assets/b.gif": { dataUrl: GIF },
    }),
  });
  const image = visibleImages(view)[0];
  assert.ok(image);
  assert.equal(image.getAttribute("src"), GIF);
  assert.equal(
    image.closest<HTMLElement>(".zmd-lp-image")?.dataset.zmdImageFrom,
    String(source.indexOf("![Figure]")),
  );
});

test("resizing one reference-style occurrence leaves its shared definition and siblings intact", async (t) => {
  const source =
    "![First][ref]\n\n![Second][ref]\n\n[ref]: assets/a.png\n\nEnd";
  const { view, win, setLiveImageAssets } = await editor(t, source);
  view.dispatch({
    effects: setLiveImageAssets.of({ "assets/a.png": { dataUrl: PNG } }),
  });
  const image = visibleImages(view)[0];
  assert.ok(image);
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 640 },
    naturalHeight: { configurable: true, value: 480 },
  });
  image.dispatchEvent(
    new win.PointerEvent("pointerdown", { button: 0, bubbles: true }),
  );
  const small = view.dom.querySelector<HTMLButtonElement>(
    '.zmd-image-controls button[data-width="240"]',
  );
  assert.ok(small);
  small.click();
  const result = view.state.doc.toString();
  assert.match(result, /^<img src="assets\/a.png" alt="First" width="240">/);
  assert.ok(result.includes("![Second][ref]"));
  assert.ok(result.includes("[ref]: assets/a.png"));
  assert.ok(undo(view));
  assert.equal(view.state.doc.toString(), source);
});

test("table edge controls read the editor labels facet", async (t) => {
  const { view } = await editor(
    t,
    "| A | B |\n| - | - |\n| one | two |\n\nEnd",
  );
  const button = view.dom.querySelector<HTMLButtonElement>(
    ".zmd-lp-table-edge-action.is-column.is-first-row",
  );
  assert.ok(button);
  assert.equal(button.title, "新增列测试");
});
