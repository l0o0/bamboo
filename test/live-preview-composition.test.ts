import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

type Observer = {
  pendingRecords(): readonly unknown[];
  flush(): void;
};

function observer(view: EditorView) {
  return (view as unknown as { observer: Observer }).observer;
}

async function fixture(t: TestContext, live: boolean) {
  const win = new Window({ url: "https://editor.test/?channel=composition" });
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
  let dispatches = 0;
  let destroyed = false;
  const errors: unknown[] = [];
  const view = new EditorView({
    parent: parent as unknown as HTMLElement,
    state: EditorState.create({
      doc: "# n",
      selection: { anchor: 3 },
      extensions: [
        markdown(),
        ...(live ? [api.livePreviewPlugin()] : []),
        EditorView.exceptionSink.of((error) => errors.push(error)),
      ],
    }),
    dispatchTransactions(transactions, current) {
      dispatches++;
      current.update(transactions);
    },
  });
  const destroy = () => {
    if (!destroyed) {
      destroyed = true;
      view.destroy();
    }
  };
  t.after(async () => {
    destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.deepEqual(errors, [], "no asynchronous editor/plugin exceptions");
  });
  view.focus();
  assert.equal(view.hasFocus, true);
  observer(view).flush();
  const composition = (type: "compositionstart" | "compositionend") =>
    view.contentDOM.dispatchEvent(
      new win.CompositionEvent(type, { bubbles: true }) as unknown as Event,
    );
  const pendingChinese = () => {
    const node = win.document.getSelection()?.focusNode;
    assert.ok(node && node.nodeType === 3, "caret is in a real Text node");
    const value = node.nodeValue;
    assert.ok(value && value.endsWith("n"));
    node.nodeValue = value.slice(0, -1) + "中";
    // Do not collapse the native selection here: that can flush the mutation
    // early and hide the composition-event dispatch race this test exercises.
    assert.equal(observer(view).pendingRecords().length, 1);
    assert.equal(
      view.state.doc.toString(),
      "# n",
      "DOM input is still pending",
    );
    return node;
  };
  return {
    view,
    win,
    composition,
    pendingChinese,
    plugin: () => view.plugin(api.livePreviewViewPlugin),
    dispatches: () => dispatches,
    destroy,
  };
}

test("compositionend retains the final pending DOM character and its Text node", async (t) => {
  for (const live of [false, true]) {
    await t.test(
      live ? "with live preview" : "without live preview",
      async (t) => {
        const { view, win, composition, pendingChinese } = await fixture(
          t,
          live,
        );
        composition("compositionstart");
        assert.equal(view.compositionStarted, true);
        const node = pendingChinese();
        composition("compositionend");
        await Promise.resolve();
        assert.equal(view.state.doc.toString(), "# 中");
        assert.equal(view.contentDOM.textContent, "# 中");
        assert.equal(win.document.getSelection()?.focusNode, node);
        assert.equal(node.isConnected, true);
      },
    );
  }
});

test("compositionstart does not roll back a DOM character waiting for the observer", async (t) => {
  for (const live of [false, true]) {
    await t.test(
      live ? "with live preview" : "without live preview",
      async (t) => {
        const { view, win, composition, pendingChinese } = await fixture(
          t,
          live,
        );
        const node = pendingChinese();
        composition("compositionstart");
        assert.equal(view.compositionStarted, true);
        assert.equal(
          view.contentDOM.textContent,
          "# 中",
          "pending DOM survives start",
        );
        observer(view).flush();
        assert.equal(view.state.doc.toString(), "# 中");
        assert.equal(win.document.getSelection()?.focusNode, node);
        assert.equal(node.isConnected, true);
        composition("compositionend");
      },
    );
  }
});

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("composition flags change without forced transactions or decoration rebuilds", async (t) => {
  const { view, composition, plugin, dispatches } = await fixture(t, true);
  const preview = plugin()!;
  const decorations = preview.decorations;
  const line = view.contentDOM.firstChild;
  const before = dispatches();
  composition("compositionstart");
  assert.equal(preview.composing, true);
  assert.equal(view.compositionStarted, true);
  assert.equal(
    view.composing,
    false,
    "the first DOM input has not arrived yet",
  );
  assert.equal(dispatches(), before);
  assert.equal(preview.decorations, decorations);
  assert.equal(view.contentDOM.firstChild, line);
  composition("compositionend");
  assert.equal(preview.composing, true, "clearing waits for pending DOM input");
  assert.equal(dispatches(), before);
  await nextTask();
  assert.equal(preview.composing, false);
  assert.equal(preview.decorations, decorations);
  assert.equal(view.contentDOM.firstChild, line);
  assert.equal(dispatches(), before);
});

test("a new composition cancels the previous end timer", async (t) => {
  const { view, composition, plugin, dispatches } = await fixture(t, true);
  const before = dispatches();
  composition("compositionstart");
  composition("compositionend");
  composition("compositionstart");
  await nextTask();
  assert.equal(plugin()!.composing, true);
  assert.equal(view.compositionStarted, true);
  assert.equal(dispatches(), before);
  composition("compositionend");
  await nextTask();
  assert.equal(plugin()!.composing, false);
  assert.equal(dispatches(), before);
});

test("destroy cancels deferred composition cleanup and performs no later dispatch", async (t) => {
  const { composition, plugin, dispatches, destroy } = await fixture(t, true);
  composition("compositionstart");
  composition("compositionend");
  const preview = plugin()!;
  assert.equal(preview.composing, true);
  const before = dispatches();
  destroy();
  assert.equal(preview.composing, false);
  await nextTask();
  assert.equal(dispatches(), before);
  assert.equal(preview.composing, false);
});

test("blur releases live-preview bookkeeping when the end event is missing or deferred", async (t) => {
  for (const end of [false, true]) {
    await t.test(end ? "pending end timer" : "missing end event", async (t) => {
      const { view, composition, plugin } = await fixture(t, true);
      composition("compositionstart");
      if (end) composition("compositionend");
      view.contentDOM.blur();
      assert.equal(view.hasFocus, false);
      assert.equal(plugin()!.composing, false);
      await nextTask();
      assert.equal(plugin()!.composing, false);
    });
  }
});

test("a state effect preserves the Text node after real composition input is committed", async (t) => {
  const { view, win, composition, pendingChinese } = await fixture(t, true);
  composition("compositionstart");
  const node = pendingChinese();
  observer(view).flush();
  assert.equal(view.state.doc.toString(), "# 中");
  assert.equal(view.composing, true);
  const parent = node.parentNode;
  const effect = StateEffect.define<number>();
  view.dispatch({ effects: effect.of(1) });
  assert.equal(win.document.getSelection()?.focusNode, node);
  assert.equal(node.parentNode, parent);
  assert.equal(node.isConnected, true);
  assert.equal(view.state.doc.toString(), "# 中");
  assert.equal(view.contentDOM.textContent, "# 中");
  composition("compositionend");
  await nextTask();
});
