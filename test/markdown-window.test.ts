import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { openMarkdownTab } from "../src/modules/markdown/tab.ts";
import { sessionRegistry } from "../src/modules/markdown/session-registry.ts";

const windowSource = readFileSync(
  new URL("../src/modules/markdown/window.ts", import.meta.url),
  "utf8",
);
const hostSource = readFileSync(
  new URL("../addon/content/markdownWindow.xhtml", import.meta.url),
  "utf8",
);
const tabSource = readFileSync(
  new URL("../src/modules/markdown/tab.ts", import.meta.url),
  "utf8",
);

test("uses the shared editor surface instead of a second editor implementation", () => {
  assert.match(windowSource, /mountMarkdownEditorSurface/);
  assert.match(windowSource, /refreshMarkdownSessionOnFocus/);
  assert.doesNotMatch(windowSource, /createMarkdownEditor/);
  assert.match(windowSource, /injectMarkdownStyles/);
});

test("explicitly refreshes a reused standalone window", () => {
  assert.match(windowSource, /windows\.get\(item\.id\)/);
  assert.match(windowSource, /await refreshMarkdownSessionOnFocus\(/);
});

test("uses a script-free chrome host for the standalone window", () => {
  assert.match(hostSource, /bamboo-markdown-window-root/);
  assert.doesNotMatch(hostSource, /<script/i);
  assert.match(hostSource, /width: 100%/);
});

test("does not tear down the shared surface until the close save succeeds", () => {
  const closeSession = tabSource.slice(
    tabSource.indexOf("export async function closeMarkdownSession"),
    tabSource.indexOf("/** Close (and flush) an open Markdown tab"),
  );
  assert.ok(
    closeSession.indexOf("await session.save.request") <
      closeSession.indexOf("session.modal?.destroy()"),
  );
});

function pendingTabOpen(
  t: TestContext,
  stage: "path" | "read" | "title",
  readFailure = false,
) {
  const win = new Window();
  let allow = true;
  let pathReads = 0;
  let nativeTabs = 0;
  let reports = 0;
  let started!: () => void;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const wait = async (value: string) => {
    started();
    await resumed;
    return value;
  };
  const item = {
    id: 8801,
    attachmentFilename: stage === "title" ? "" : "note.md",
    isStoredFileAttachment: () => true,
    getField: () => "",
    getDisplayTitle: () =>
      stage === "title" ? wait("Research note") : "Research note",
    getFilePathAsync: async () => {
      pathReads += 1;
      return stage === "path" ? wait("/tmp/note.md") : "/tmp/note.md";
    },
  } as unknown as Zotero.Item;
  Object.assign(win, {
    Zotero_Tabs: {
      add() {
        nativeTabs += 1;
        throw new Error("A canceled opening must not create a native tab");
      },
    },
  });
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = [
    "Zotero",
    "ztoolkit",
    "addon",
    "__zoteroMarkdownDOMGlobalsInjected",
    "window",
    "self",
    "document",
    "HTMLElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "Text",
    "DocumentFragment",
    "DOMParser",
    "Range",
    "Selection",
    "NodeFilter",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getSelection",
    "CSS",
    "CSSStyleSheet",
    "CustomEvent",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "InputEvent",
    "navigator",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globals, key)]),
  );
  Object.assign(globals, {
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
    },
    ztoolkit: {
      log() {},
      ProgressWindow: class {
        createLine() {
          return this;
        }
        show() {
          reports += 1;
          return this;
        }
      },
    },
    Zotero: {
      getMainWindow: () => win,
      Items: { get: () => item },
      File: {
        getContentsAsync: async () => {
          const content =
            stage === "read"
              ? await wait("# Research note\n")
              : "# Research note\n";
          if (readFailure) throw new Error("read failed after host teardown");
          return content;
        },
      },
    },
  });
  t.after(() => {
    win.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else Reflect.deleteProperty(globals, key);
    }
  });
  return {
    win,
    item,
    waiting,
    finish,
    cancel() {
      allow = false;
    },
    open: () =>
      openMarkdownTab(item, {
        win: win as unknown as _ZoteroTypes.MainWindow,
        shouldOpen: () => allow,
      }),
    get pathReads() {
      return pathReads;
    },
    get nativeTabs() {
      return nativeTabs;
    },
    get reports() {
      return reports;
    },
  };
}

test("a disposed Markdown opener does not read or create a native tab", async (t) => {
  const f = pendingTabOpen(t, "path");
  f.cancel();
  assert.equal(await f.open(), null);
  assert.equal(f.pathReads, 0);
  assert.equal(f.nativeTabs, 0);
});

for (const stage of ["path", "read", "title"] as const) {
  test(`Markdown tab opening canceled during ${stage} I/O never mounts an old editor`, async (t) => {
    const f = pendingTabOpen(t, stage);
    const opening = f.open();
    await f.waiting;
    f.cancel();
    f.finish();
    assert.equal(await opening, null);
    assert.equal(f.nativeTabs, 0);
    assert.equal(f.reports, 0);
    assert.equal(
      sessionRegistry.find(
        f.win as unknown as globalThis.Window,
        f.item.id,
        "tab",
      ),
      undefined,
    );
  });
}

test("a late Markdown read failure after disposal does not show a stale window error", async (t) => {
  const f = pendingTabOpen(t, "read", true);
  const opening = f.open();
  await f.waiting;
  f.cancel();
  f.finish();
  assert.equal(await opening, null);
  assert.equal(f.nativeTabs, 0);
  assert.equal(f.reports, 0);
});
