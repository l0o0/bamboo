import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import { EDITOR_MESSAGE_SOURCE } from "../src/modules/markdown/editor-protocol.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the real iframe defers background UI work until native composition settles", async (t) => {
  const browser = new Window({ url: "https://editor.test/?channel=ime-test" });
  const globals = globalThis as any;
  const previous = new Map(
    Object.getOwnPropertyNames(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globals, key)!,
    ]),
  );
  globals.ztoolkit = { log() {} };
  ensureDOMGlobals(browser as any);
  globals.Window = browser.Window;
  browser.document.body.innerHTML = '<div id="editor-root"></div>';
  const messages: { type: string; payload?: any }[] = [];
  browser.postMessage = (message: any) => {
    messages.push(message);
  };
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "ime-test",
          type,
          payload,
        },
      }),
    );
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  const init = (doc: string) => {
    send("init", {
      doc,
      readOnly: false,
      fontSize: 14,
      theme: "light",
      mode: "live",
    });
    const view = EditorView.findFromDOM(
      browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
    )!;
    assert.ok(view);
    view.focus();
    view.dispatch({ selection: { anchor: doc.length } });
    messages.length = 0;
    return view;
  };
  const composition = (view: EditorView, type: string) =>
    view.contentDOM.dispatchEvent(
      new browser.CompositionEvent(type, { bubbles: true }),
    );
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });

  await t.test(
    "outline updates and link lookup stay quiet during a candidate pause, then use committed text",
    async () => {
      const view = init("# ");
      composition(view, "compositionstart");
      view.dispatch({
        changes: { from: 2, insert: "zhong" },
        selection: { anchor: 7 },
        userEvent: "input.type.compose",
      });
      await wait(160);
      assert.deepEqual(
        messages
          .filter((m) => m.type === "composition")
          .map((m) => m.payload.active),
        [true],
      );
      assert.ok(
        messages.some((m) => m.type === "change"),
        "the latest buffer still reaches the parent",
      );
      assert.equal(
        messages.filter((m) =>
          ["outline", "outlineActive", "linkSearch"].includes(m.type),
        ).length,
        0,
      );
      view.dispatch({
        changes: { from: 2, to: 7, insert: "中" },
        selection: { anchor: 3 },
        userEvent: "input.type.compose",
      });
      composition(view, "compositionend");
      assert.equal(
        messages.filter((m) => m.type === "composition").length,
        1,
        "end is not published in the native event stack",
      );
      await wait(160);
      assert.deepEqual(
        messages
          .filter((m) => m.type === "composition")
          .map((m) => m.payload.active),
        [true, false],
      );
      assert.equal(
        messages.findLast((m) => m.type === "outline")?.payload.items[0].text,
        "中",
      );
      const end = messages.findIndex(
        (m) => m.type === "composition" && !m.payload.active,
      );
      assert.ok(messages.findLastIndex((m) => m.type === "change") < end);
    },
  );

  await t.test(
    "link completion releases candidate keys and ignores in-flight search results",
    async () => {
      const view = init("[[");
      view.dispatch({
        changes: { from: 2, insert: "n" },
        selection: { anchor: 3 },
      });
      const request = messages.findLast(
        (m) => m.type === "linkSearch",
      )!.payload;
      const results = [
        {
          key: "NOTE0001",
          libraryID: 1,
          title: "Note",
          kind: "markdown",
          filename: "note.md",
          href: "note--NOTE0001.md",
        },
      ];
      send("linkSearchResults", { ...request, results });
      assert.ok(browser.document.querySelector('[role="listbox"]'));
      const key = new browser.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      // Target the popup's capture listener without involving CodeMirror's
      // own contentDOM keymap in this synthetic key-only fallback case.
      view.dom.dispatchEvent(key);
      assert.equal(key.defaultPrevented, false);
      assert.equal(view.state.doc.toString(), "[[n");
      const legacyKey = new browser.KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(legacyKey);
      assert.equal(legacyKey.defaultPrevented, false);
      composition(view, "compositionstart");
      assert.equal(browser.document.querySelector('[role="listbox"]'), null);
      send("linkSearchResults", { ...request, results });
      assert.equal(browser.document.querySelector('[role="listbox"]'), null);
      messages.length = 0;
      view.dispatch({
        changes: { from: 2, to: 3, insert: "你" },
        selection: { anchor: 3 },
        userEvent: "input.type.compose",
      });
      assert.equal(
        messages.some((m) => m.type === "linkSearch"),
        false,
      );
      composition(view, "compositionend");
      await wait(25);
      assert.equal(
        messages.findLast((m) => m.type === "linkSearch")?.payload.query,
        "你",
      );
    },
  );

  await t.test(
    "the final native DOM mutation reaches the parent before composition completion",
    async () => {
      const view = init("# n");
      const at = view.domAtPos(3);
      const node =
        at.node.nodeType === 3 ? at.node : at.node.childNodes[at.offset - 1];
      composition(view, "compositionstart");
      node.nodeValue = node.nodeValue!.replace("n", "中");
      assert.equal(view.state.doc.toString(), "# n");
      composition(view, "compositionend");
      await wait(25);
      assert.equal(view.state.doc.toString(), "# 中");
      assert.equal(view.contentDOM.textContent, "# 中");
      const change = messages.findIndex(
        (m) =>
          m.type === "change" &&
          m.payload.changes.some((c: { insert: string }) =>
            c.insert.includes("中"),
          ),
      );
      const end = messages.findIndex(
        (m) => m.type === "composition" && !m.payload.active,
      );
      assert.ok(
        change >= 0 && change < end,
        "committed text precedes resumed title/save work",
      );
    },
  );

  await t.test(
    "a second composition cancels the previous end callback, and blur releases the parent background-work guard",
    async () => {
      const view = init("# Heading");
      composition(view, "compositionstart");
      composition(view, "compositionend");
      composition(view, "compositionstart");
      await wait(25);
      assert.deepEqual(
        messages
          .filter((m) => m.type === "composition")
          .map((m) => m.payload.active),
        [true],
      );
      view.contentDOM.blur();
      await wait(25);
      assert.deepEqual(
        messages
          .filter((m) => m.type === "composition")
          .map((m) => m.payload.active),
        [true, false],
      );
      assert.equal(
        messages.some((m) => m.type === "linkSearch"),
        false,
      );
    },
  );

  await t.test(
    "reset and teardown cancel stale composition timers",
    async () => {
      const view = init("# Old");
      composition(view, "compositionstart");
      composition(view, "compositionend");
      init("# New");
      await wait(150);
      assert.equal(
        messages.some((m) => m.type === "composition"),
        false,
      );
      assert.equal(
        messages.some(
          (m) => m.type === "outline" && m.payload.items[0]?.text === "Old",
        ),
        false,
      );
      const current = EditorView.findFromDOM(
        browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
      )!;
      composition(current, "compositionstart");
      composition(current, "compositionend");
      send("destroy");
      messages.length = 0;
      await wait(150);
      assert.equal(messages.length, 0);
    },
  );
});
