import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EditorView } from "@codemirror/view";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  createLinkCompletionPopup,
  DEFAULT_LINK_LABELS,
  linkCompletionPosition,
} from "../src/editor/link-completion.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  type EditorLinkCandidate,
  type EditorLinkFilter,
} from "../src/modules/markdown/editor-protocol.ts";

const candidate: EditorLinkCandidate = {
  key: "BOOK0001",
  libraryID: 1,
  title: "A study",
  kind: "regular",
  kindLabel: "Book",
  icon: "chrome://zotero/skin/item-type/16/light/book.svg",
  href: "zotero://select/library/items/BOOK0001",
};
const secondCandidate: EditorLinkCandidate = {
  ...candidate,
  key: "BOOK0002",
  title: "Another study",
  href: "zotero://select/library/items/BOOK0002",
};

function popupFixture() {
  const win = new Window({ width: 400, height: 500 });
  const doc = win.document;
  const host = doc.createElement("main");
  const content = doc.createElement("textarea");
  host.append(content);
  doc.body.append(host);
  content.focus();
  let composing = false;
  const chosen: EditorLinkCandidate[] = [];
  const filters: EditorLinkFilter[] = [];
  let dismissed = 0;
  const popup = createLinkCompletionPopup({
    host: host as unknown as HTMLElement,
    contentDOM: content as unknown as HTMLElement,
    labels: DEFAULT_LINK_LABELS,
    isComposing: () => composing,
    focusEditor: () => content.focus(),
    anchor: () => ({ left: 380, top: 420, bottom: 440 }),
    onFilter: (filter) => filters.push(filter),
    onChoose: (value) => chosen.push(value),
    onDismiss: () => dismissed++,
  });
  const key = (value: string, extra: Record<string, unknown> = {}) => {
    const event = new win.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    doc.activeElement?.dispatchEvent(event);
    return event;
  };
  return {
    win,
    doc,
    host,
    content,
    popup,
    chosen,
    filters,
    key,
    get dismissed() {
      return dismissed;
    },
    set composing(value: boolean) {
      composing = value;
    },
    async destroy() {
      popup.destroy();
      await win.happyDOM.close();
    },
  };
}

test("completion geometry clamps narrow/right-edge and chooses space above the cursor", () => {
  const above = linkCompletionPosition(
    { left: 298, top: 470, bottom: 488 },
    { width: 320, height: 500 },
    302,
  );
  assert.deepEqual(above, { width: 304, height: 302, left: 8, top: 164 });
  const below = linkCompletionPosition(
    { left: 20, top: 20, bottom: 40 },
    { width: 800, height: 700 },
    220,
  );
  assert.deepEqual(below, { width: 392, height: 220, left: 20, top: 44 });
  const short = linkCompletionPosition(
    { left: 300, top: 90, bottom: 110 },
    { width: 320, height: 180 },
    302,
  );
  assert.ok(short.top >= 8 && short.top + short.height <= 172);
  assert.ok(short.left + short.width <= 312);
});

test("filter row survives loading/empty states and candidate keys stay in tooltips only", async () => {
  const f = popupFixture();
  try {
    f.popup.update("all", [], true);
    assert.equal(f.host.querySelectorAll("[data-link-filter]").length, 4);
    assert.equal(
      f.host.querySelector('[role="status"]')?.textContent,
      DEFAULT_LINK_LABELS.loading,
    );
    f.popup.update("open", [], false);
    assert.equal(
      f.host
        .querySelector('[data-link-filter="open"]')
        ?.getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      f.host.querySelector('[role="status"]')?.textContent,
      DEFAULT_LINK_LABELS.empty,
    );
    f.popup.update("all", [candidate], false);
    const row = f.host.querySelector<HTMLButtonElement>('[role="option"]')!;
    assert.equal(row.textContent, "A studyBook");
    assert.match(row.title, /BOOK0001/);
    const icon = row.querySelector<HTMLImageElement>("img")!;
    assert.equal(icon.src, candidate.icon);
    assert.equal(icon.width, 16);
    assert.equal(icon.height, 16);
    assert.equal(f.content.getAttribute("aria-activedescendant"), row.id);
    f.popup.destroy();
    assert.equal(f.content.getAttribute("aria-controls"), null);
    assert.equal(f.content.getAttribute("aria-activedescendant"), null);
  } finally {
    await f.destroy();
  }
});

test("Tab immediately cycles filters in both directions while preserving editor focus and selection", async () => {
  const f = popupFixture();
  try {
    f.popup.update("all", [candidate], false);
    f.content.value = "[[study|shown label";
    f.content.setSelectionRange(18, 18);
    for (const expected of ["regular", "notes-attachments", "open", "all"]) {
      assert.equal(f.key("Tab").defaultPrevented, true);
      assert.equal(f.filters.at(-1), expected);
      assert.equal(f.doc.activeElement, f.content);
      assert.equal(f.content.selectionStart, 18);
      assert.equal(f.content.selectionEnd, 18);
      assert.equal(f.content.value, "[[study|shown label");
    }
    for (const expected of ["open", "notes-attachments", "regular", "all"]) {
      assert.equal(f.key("Tab", { shiftKey: true }).defaultPrevented, true);
      assert.equal(f.filters.at(-1), expected);
      assert.equal(f.doc.activeElement, f.content);
    }

    const button = f.host.querySelector<HTMLButtonElement>(
      '[data-link-filter="regular"]',
    )!;
    const down = new f.win.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(down);
    button.click();
    assert.equal(down.defaultPrevented, true);
    assert.equal(f.doc.activeElement, f.content);
    assert.equal(f.filters.at(-1), "regular");
    f.key("Tab");
    assert.equal(f.filters.at(-1), "notes-attachments");
    assert.equal(f.doc.activeElement, f.content);
    assert.equal(f.content.selectionStart, 18);
    assert.equal(f.content.selectionEnd, 18);
    assert.equal(f.chosen.length, 0);
  } finally {
    await f.destroy();
  }
});

test("arrows select candidates and Enter chooses the active item even from a focused filter", async () => {
  const f = popupFixture();
  try {
    f.popup.update("all", [candidate, secondCandidate], false);
    const rows = f.host.querySelectorAll<HTMLButtonElement>('[role="option"]');
    assert.equal(f.key("ArrowUp").defaultPrevented, true);
    assert.equal(f.content.getAttribute("aria-activedescendant"), rows[1].id);
    f.key("ArrowDown");
    assert.equal(f.content.getAttribute("aria-activedescendant"), rows[0].id);
    f.key("ArrowDown");
    f.key("Enter");
    assert.deepEqual(f.chosen, [secondCandidate]);

    const filter = f.host.querySelector<HTMLButtonElement>(
      '[data-link-filter="all"]',
    )!;
    filter.focus();
    f.key("ArrowRight");
    assert.equal(f.filters.at(-1), "regular");
    assert.equal(
      f.doc.activeElement?.getAttribute("data-link-filter"),
      "regular",
    );
    f.key("ArrowUp");
    assert.equal(f.doc.activeElement, f.content);
    assert.equal(f.content.getAttribute("aria-activedescendant"), rows[0].id);
    filter.focus();
    f.key("Enter");
    assert.equal(f.doc.activeElement, f.content);
    assert.deepEqual(f.chosen, [secondCandidate, candidate]);
    assert.deepEqual(f.filters, ["regular"]);
    assert.equal(f.key("Escape").defaultPrevented, true);
    assert.equal(f.dismissed, 1);
  } finally {
    await f.destroy();
  }
});

test("loading and empty results consume list keys without choosing stale items or editing the query", async () => {
  const f = popupFixture();
  try {
    f.content.value = "[[study";
    f.content.setSelectionRange(7, 7);
    for (const loading of [true, false]) {
      f.popup.update("open", loading ? [candidate] : [], loading);
      assert.equal(f.host.querySelectorAll('[role="option"]').length, 0);
      for (const key of ["ArrowDown", "ArrowUp", "Enter"]) {
        assert.equal(f.key(key).defaultPrevented, true);
        assert.equal(f.content.selectionStart, 7);
        assert.equal(f.content.selectionEnd, 7);
        assert.equal(f.content.value, "[[study");
        assert.equal(f.doc.activeElement, f.content);
      }
      assert.equal(f.key("Tab").defaultPrevented, true);
      assert.equal(f.filters.at(-1), "all");
      assert.equal(f.key("Tab", { shiftKey: true }).defaultPrevented, true);
      assert.equal(f.filters.at(-1), "open");
      assert.equal(f.key("Escape").defaultPrevented, true);
    }
    assert.equal(f.chosen.length, 0);
    assert.equal(f.dismissed, 2);
  } finally {
    await f.destroy();
  }
});

test("modified shortcuts remain available to the editor and host", async () => {
  const f = popupFixture();
  try {
    f.popup.update("all", [candidate, secondCandidate], false);
    const active = f.content.getAttribute("aria-activedescendant");
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
      for (const key of ["Tab", "ArrowDown", "ArrowUp", "Enter", "Escape"]) {
        if (modifier === "shiftKey" && key === "Tab") continue;
        assert.equal(f.key(key, { [modifier]: true }).defaultPrevented, false);
      }
    }
    assert.equal(f.content.getAttribute("aria-activedescendant"), active);
    assert.equal(f.filters.length, 0);
    assert.equal(f.chosen.length, 0);
    assert.equal(f.dismissed, 0);
  } finally {
    await f.destroy();
  }
});

test("candidate metadata shows the first author as plain text and preserves long names in the tooltip", async () => {
  const f = popupFixture();
  try {
    const author = "<img src=x onerror=alert(1)>" + "研究中心".repeat(25);
    f.popup.update(
      "all",
      [{ ...candidate, kindLabel: "期刊文章", author }],
      false,
    );
    const row = f.host.querySelector<HTMLButtonElement>('[role="option"]')!;
    const detail = row.querySelector("span")!.lastElementChild as HTMLElement;
    assert.equal(detail.textContent, `期刊文章 · ${author}`);
    assert.equal(row.title, `A study · 期刊文章 · ${author} [BOOK0001]`);
    assert.equal(row.querySelectorAll("img").length, 1);
    assert.equal(detail.childElementCount, 0);
    assert.equal(detail.style.textOverflow, "ellipsis");
    assert.equal(detail.style.whiteSpace, "nowrap");
    assert.equal(detail.style.overflow, "hidden");

    f.popup.update("all", [candidate], false);
    const noAuthor =
      f.host.querySelector<HTMLButtonElement>('[role="option"]')!;
    assert.equal(
      noAuthor.querySelector("span")!.lastElementChild!.textContent,
      "Book",
    );
    assert.equal(noAuthor.title, "A study · Book [BOOK0001]");
  } finally {
    await f.destroy();
  }
});

test("IME keys and filter clicks do not dispatch candidates, while empty results still allow Escape", async () => {
  const f = popupFixture();
  try {
    f.popup.update("all", [candidate], false);
    for (const extra of [{ isComposing: true }, { keyCode: 229 }])
      for (const key of ["Tab", "ArrowDown", "ArrowUp", "Enter", "Escape"])
        assert.equal(f.key(key, extra).defaultPrevented, false);
    f.composing = true;
    assert.equal(f.key("ArrowDown").defaultPrevented, false);
    assert.equal(f.key("Tab").defaultPrevented, false);
    f.host
      .querySelector<HTMLButtonElement>('[data-link-filter="open"]')!
      .click();
    f.host.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    assert.equal(f.chosen.length, 0);
    assert.equal(f.filters.length, 0);
    f.composing = false;
    f.popup.update("open", [], false);
    assert.equal(f.key("Escape").defaultPrevented, true);
    assert.equal(f.dismissed, 1);
  } finally {
    await f.destroy();
  }
});

test("popup cleanup removes keyboard, window, outside-pointer and scheduled listeners", async () => {
  const f = popupFixture();
  f.popup.update("all", [candidate], false);
  f.popup.destroy();
  assert.equal(f.host.querySelector(".zmd-link-completion"), null);
  assert.equal(f.key("Enter").defaultPrevented, false);
  f.win.dispatchEvent(new f.win.Event("blur"));
  f.doc.body.dispatchEvent(
    new f.win.PointerEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(f.dismissed, 0);
  assert.equal(f.chosen.length, 0);
  await f.win.happyDOM.close();
});

test("the real iframe keeps query/selection while switching filters and rejects stale responses", async (t) => {
  const browser = new Window({
    url: "https://editor.test/?channel=links-test",
  });
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
  browser.postMessage = (message: any) => messages.push(message);
  const send = (type: string, payload?: unknown) =>
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: browser,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "links-test",
          type,
          payload,
        },
      }),
    );
  await import("../src/editor/bootstrap.ts");
  browser.document.dispatchEvent(new browser.Event("DOMContentLoaded"));
  t.after(async () => {
    send("destroy");
    await browser.happyDOM.close();
    for (const key of Object.getOwnPropertyNames(globals)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  const init = (text: string) => {
    send("init", {
      doc: text,
      readOnly: false,
      fontSize: 14,
      theme: "dark",
      mode: "live",
      linkLabels: { ...DEFAULT_LINK_LABELS, all: "全部", open: "已打开" },
    });
    const view = EditorView.findFromDOM(
      browser.document.querySelector(".cm-editor") as unknown as HTMLElement,
    )!;
    view.focus();
    view.dispatch({ selection: { anchor: text.length } });
    return view;
  };
  const latest = () =>
    messages.findLast((message) => message.type === "linkSearch")!.payload;
  const rows = () => browser.document.querySelectorAll('[role="option"]');
  const view = init("[[study|shown label");
  const key = (value: string, extra: Record<string, unknown> = {}) => {
    const event = new browser.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    view.contentDOM.dispatchEvent(event as unknown as KeyboardEvent);
    return event;
  };
  const first = latest();
  assert.equal(first.filter, "all");
  assert.equal(
    browser.document.querySelector('[data-link-filter="all"]')?.textContent,
    "全部",
  );
  send("linkSearchResults", { ...first, results: [candidate] });
  assert.equal(rows().length, 1);
  const selection = view.state.selection.main.head;
  const open = browser.document.querySelector<HTMLButtonElement>(
    '[data-link-filter="open"]',
  )!;
  open.dispatchEvent(
    new browser.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  open.click();
  const filtered = latest();
  assert.equal(filtered.filter, "open");
  assert.equal(filtered.query, "study");
  assert.equal(view.state.selection.main.head, selection);
  assert.equal(view.state.doc.toString(), "[[study|shown label");
  assert.equal(view.hasFocus, true);
  assert.equal(rows().length, 0);
  assert.equal(
    browser.document.querySelector('[role="status"]')?.textContent,
    DEFAULT_LINK_LABELS.loading,
  );
  send("linkSearchResults", { ...first, results: [candidate] });
  assert.equal(rows().length, 0);
  send("linkSearchResults", {
    ...filtered,
    filter: "regular",
    results: [candidate],
  });
  assert.equal(rows().length, 0);
  send("linkSearchResults", {
    ...filtered,
    query: "different",
    results: [candidate],
  });
  assert.equal(rows().length, 0);
  send("linkSearchResults", { ...filtered, results: [] });
  assert.equal(
    browser.document.querySelectorAll("[data-link-filter]").length,
    4,
  );
  assert.equal(
    browser.document.querySelector('[role="status"]')?.textContent,
    DEFAULT_LINK_LABELS.empty,
  );
  for (const keyName of ["ArrowDown", "ArrowUp", "Enter"]) {
    assert.equal(key(keyName).defaultPrevented, true);
    assert.equal(view.state.selection.main.head, selection);
    assert.equal(view.state.doc.toString(), "[[study|shown label");
  }

  const keyboardRequests = [];
  for (const expected of ["all", "regular", "notes-attachments", "open"]) {
    assert.equal(key("Tab").defaultPrevented, true);
    const request = latest();
    keyboardRequests.push(request);
    assert.equal(request.filter, expected);
    assert.equal(request.query, "study");
    assert.equal(view.hasFocus, true);
    assert.equal(view.state.selection.main.head, selection);
    assert.equal(view.state.doc.toString(), "[[study|shown label");
    assert.equal(
      browser.document
        .querySelector(`[data-link-filter="${expected}"]`)
        ?.getAttribute("aria-pressed"),
      "true",
    );
  }
  assert.equal(key("Tab", { shiftKey: true }).defaultPrevented, true);
  assert.equal(latest().filter, "notes-attachments");
  assert.equal(view.hasFocus, true);
  for (const request of keyboardRequests)
    send("linkSearchResults", { ...request, results: [candidate] });
  assert.equal(rows().length, 0);
  for (const keyName of ["ArrowDown", "ArrowUp", "Enter"]) {
    assert.equal(key(keyName).defaultPrevented, true);
    assert.equal(view.state.selection.main.head, selection);
    assert.equal(view.state.doc.toString(), "[[study|shown label");
  }

  // Typing remains in the editor after cycling, retaining the chosen filter.
  view.dispatch({
    changes: { from: selection, insert: "!" },
    selection: { anchor: selection + 1 },
  });
  const typed = latest();
  assert.equal(typed.filter, "notes-attachments");
  assert.equal(typed.query, "study");
  assert.equal(view.hasFocus, true);
  send("linkSearchResults", {
    ...typed,
    results: [candidate, secondCandidate],
  });
  assert.equal(rows().length, 2);
  assert.equal(key("ArrowDown").defaultPrevented, true);
  assert.equal(
    view.contentDOM.getAttribute("aria-activedescendant"),
    rows()[1].id,
  );
  assert.equal(key("ArrowUp").defaultPrevented, true);
  assert.equal(
    view.contentDOM.getAttribute("aria-activedescendant"),
    rows()[0].id,
  );
  key("ArrowDown");
  assert.equal(view.state.selection.main.head, selection + 1);
  assert.equal(key("Enter").defaultPrevented, true);
  assert.equal(
    view.state.doc.toString(),
    "[shown label!](zotero://select/library/items/BOOK0002)",
  );
  assert.equal(browser.document.querySelector(".zmd-link-completion"), null);
  const next = init("[[again");
  const pending = latest();
  next.dom.dispatchEvent(
    new browser.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  send("linkSearchResults", { ...pending, results: [candidate] });
  assert.equal(browser.document.querySelector(".zmd-link-completion"), null);
  assert.equal(next.state.doc.toString(), "[[again");
});
