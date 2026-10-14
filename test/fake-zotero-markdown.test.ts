import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  createFakeZotero,
  type FakeZoteroInstance,
} from "../packages/fake-zotero/dist/index.js";
import {
  buildDocumentLink,
  openDocumentLink,
  searchDocumentLinks,
} from "../src/modules/markdown/document-links.ts";
import {
  buildNoteWithFrontmatter,
  parseFrontmatter,
} from "../src/modules/markdown/frontmatter.ts";
import { persistMarkdownContent } from "../src/modules/markdown/persist.ts";
import {
  createMarkdownEditor,
  applyMarkdownEditorPreferences,
} from "../src/modules/markdown/editor.ts";
import { ensureDOMGlobals } from "../src/utils/dom.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
} from "../src/modules/markdown/editor-protocol.ts";

function install(fake: FakeZoteroInstance) {
  const globals = globalThis as Record<string, any>;
  const previous = globals.Zotero;
  const restore = fake.install(globals);
  return () => {
    restore();
    if (previous !== undefined) globals.Zotero = previous;
  };
}

test("fake Zotero drives frontmatter generation from a real parent item", (t) => {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PAPER001",
        itemType: "journalArticle",
        fields: { title: "Paper title", date: "2026-09-22", DOI: "10/x" },
        creators: [
          { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
        ],
        tags: [{ tag: "fixture" }],
      },
    ],
  });
  t.after(install(fake));

  const item = fake.Zotero.Items.get(1);
  assert.ok(item);
  const source = buildNoteWithFrontmatter({
    title: "Paper-note-2026",
    parent: item,
  });
  const { data, body } = parseFrontmatter(source);
  assert.equal(data.title, "Paper-note-2026");
  assert.equal(data.zoteroKey, "PAPER001");
  assert.equal(data.libraryID, 1);
  assert.deepEqual(data.authors, ["Ada Lovelace"]);
  assert.deepEqual(data.tags, ["fixture"]);
  assert.match(body, /^# Paper-note-2026/m);
});

test("fake attachment persists content and syncs title and file state", async (t) => {
  const fake = createFakeZotero({
    items: [
      {
        id: 2,
        key: "MD00001",
        itemType: "attachment",
        attachmentContentType: "text/markdown",
        fields: { title: "Old.md" },
      },
    ],
  });
  t.after(install(fake));

  // The package deliberately leaves Zotero.File out. This is the explicit
  // in-memory host adapter used to exercise the production write path.
  const files = new Map<string, string>();
  const zotero = fake.Zotero as any;
  zotero.Attachments = {
    LINK_MODE_IMPORTED_FILE: 0,
    LINK_MODE_LINKED_URL: 3,
  };
  zotero.File = {
    putContentsAsync: async (path: string, value: string) => {
      files.set(path, value);
    },
  };

  const item = fake.Zotero.Items.get(2) as any;
  item.attachmentLinkMode = 0;
  item.getFilePathAsync = async () => "/memory/MD00001.md";
  const result = await persistMarkdownContent(item, "# New title\n\nBody", {
    syncTitle: true,
    syncFile: true,
  });

  assert.deepEqual(result, { path: "/memory/MD00001.md", titleChanged: true });
  assert.equal(files.get("/memory/MD00001.md"), "# New title\n\nBody");
  assert.equal(item.getField("title"), "New title.md");
  assert.equal(item.attachmentSyncState, "to_upload");
  assert.deepEqual(
    fake.calls
      .filter((call) => call.method === "item.saveTx")
      .map((call) => call.args),
    [[2], [2]],
  );
});

test("fake Zotero resolves and opens regular document links", async (t) => {
  const fake = createFakeZotero({
    items: [
      {
        id: 3,
        key: "REGULAR1",
        itemType: "journalArticle",
        fields: { title: "A regular item" },
      },
      {
        id: 4,
        key: "GROUP001",
        libraryID: 7,
        itemType: "journalArticle",
        fields: { title: "A group item" },
      },
    ],
    libraries: [
      { libraryID: 7, libraryType: "group", groupID: 42, name: "Group" },
    ],
  });
  t.after(install(fake));

  const win = fake.Zotero.getMainWindow() as any;
  const personal = await openDocumentLink(
    buildDocumentLink({ key: "REGULAR1", libraryID: 1, isGroup: false }),
    { win },
  );
  const group = await openDocumentLink(
    buildDocumentLink({
      key: "GROUP001",
      libraryID: 7,
      isGroup: true,
      groupID: 42,
    }),
    { win },
  );

  assert.equal(personal.status, "opened");
  assert.equal(group.status, "opened");
  assert.deepEqual(
    fake.calls
      .filter((call) => call.method === "ZoteroPane.selectItem")
      .map((call) => call.args),
    [[3], [4]],
  );
});

test("document-link search stays safe when the minimal fake has no Search API", async (t) => {
  const fake = createFakeZotero({
    items: [{ id: 5, key: "REGULAR2", itemType: "journalArticle" }],
  });
  Object.defineProperty(fake.Zotero, "Search", { value: undefined });
  t.after(install(fake));
  const item = fake.Zotero.Items.get(5);
  assert.ok(item);
  assert.deepEqual(await searchDocumentLinks(item, "anything"), []);
});

function editorHarness(
  t: { after: (fn: () => void) => void },
  options: Parameters<typeof createMarkdownEditor>[1] = {},
) {
  const fake = createFakeZotero();
  const restoreZotero = install(fake);
  const previousToolkit = (globalThis as any).ztoolkit;
  (globalThis as any).ztoolkit = { log: () => undefined };
  const browser = new Window({ url: "https://host.example/" });
  const parent = browser.document.createElement("div");
  browser.document.body.append(parent);
  const editor = createMarkdownEditor(parent, {
    doc: "abc",
    win: browser as unknown as Window,
    pageURL: "https://editor.example/index.html",
    channel: "markdown-test",
    ...options,
  });
  const iframe = parent.querySelector("iframe") as HTMLIFrameElement;
  const posted: any[] = [];
  iframe.contentWindow!.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as typeof iframe.contentWindow.postMessage;
  const ready = () => {
    browser.dispatchEvent(
      new browser.MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "markdown-test",
          v: EDITOR_PROTOCOL_VERSION,
          type: "ready",
        },
      }),
    );
  };
  t.after(() => {
    editor.destroy();
    restoreZotero();
    (globalThis as any).ztoolkit = previousToolkit;
    browser.close();
  });
  return { editor, iframe, posted, ready, fake };
}

test("editor keeps ordered edits queued before the iframe is ready", (t) => {
  const { editor, iframe, posted, ready } = editorHarness(t);
  assert.match(iframe.src, /^https:\/\/editor\.example\/index\.html\?/);
  editor.replaceRange(0, 0, "1");
  editor.replaceRange(1, 1, "2");
  editor.insertText("3", 0, 0);
  ready();

  const types = posted.map((message) => message.type);
  assert.deepEqual(types, [
    "init",
    "replaceRange",
    "replaceRange",
    "insertText",
  ]);
  assert.deepEqual(posted[1].payload, { from: 0, to: 0, insert: "1" });
  assert.deepEqual(posted[2].payload, { from: 1, to: 1, insert: "2" });
  assert.deepEqual(posted[3].payload, {
    text: "3",
    selectionFrom: 0,
    selectionTo: 0,
  });
});

test("editor setValue supersedes older pre-ready edits", (t) => {
  const { editor, posted, ready } = editorHarness(t);
  editor.replaceRange(0, 0, "stale");
  editor.wrapSelection("[");
  editor.prefixLine("# ");
  editor.command("undo");
  editor.command("redo");
  editor.command("find");
  editor.setValue("replacement");
  editor.replaceRange(0, 0, "!");
  ready();

  assert.deepEqual(
    posted.map((message) => message.type),
    ["init", "command", "setValue", "replaceRange"],
  );
  assert.deepEqual(posted[1].payload, { command: "find" });
  assert.equal(posted[2].payload.value, "replacement");
  assert.deepEqual(posted[3].payload, { from: 0, to: 0, insert: "!" });
});

test("setValue drops stale document commands before the real bootstrap is ready", async (t) => {
  const fake = createFakeZotero();
  t.after(install(fake));
  const previousToolkit = (globalThis as any).ztoolkit;
  const previousWindow = (globalThis as any).Window;
  (globalThis as any).ztoolkit = { log: () => undefined };
  const browser = new Window({ url: "https://host.example/" });
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const changed: string[] = [];
  const editor = createMarkdownEditor(container, {
    win: browser as unknown as Window,
    channel: "bootstrap-queue-test",
    doc: "abc",
    pageURL: "https://host.example/editor.html",
    onChange: (value) => changed.push(value),
  });
  const iframe = container.querySelector("iframe") as HTMLIFrameElement;
  const frame = iframe.contentWindow!;
  frame.document.body.innerHTML = '<div id="editor-root"></div>';
  (frame as any).postMessage = (message: unknown) =>
    queueMicrotask(() =>
      frame.dispatchEvent(
        new frame.MessageEvent("message", {
          data: message,
          source: browser,
        }),
      ),
    );
  (browser as any).postMessage = (message: unknown) =>
    queueMicrotask(() =>
      browser.dispatchEvent(
        new browser.MessageEvent("message", {
          data: message,
          source: frame,
        }),
      ),
    );

  editor.prefixLine("# ");
  editor.setValue("replacement");
  ensureDOMGlobals(frame as unknown as Window);
  (globalThis as any).Window = frame.Window;
  await import("../src/editor/bootstrap.ts");
  frame.document.dispatchEvent(new frame.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(editor.getValue(), "replacement");
  assert.equal(
    frame.document.querySelector(".cm-content")?.textContent,
    "replacement",
  );
  assert.deepEqual(changed, []);

  editor.destroy();
  browser.close();
  (globalThis as any).ztoolkit = previousToolkit;
  (globalThis as any).Window = previousWindow;
});

test("editor preserves all pre-ready image asset merges", (t) => {
  const { editor, posted, ready } = editorHarness(t);
  editor.setImageAssets({ "assets/a.png": { dataUrl: "a" } }, false);
  editor.setImageAssets({ "assets/b.png": { dataUrl: "b" } }, false);
  ready();

  assert.deepEqual(
    posted
      .filter((message) => message.type === "setImageAssets")
      .map((message) => message.payload),
    [
      { assets: { "assets/a.png": { dataUrl: "a" } }, replace: false },
      { assets: { "assets/b.png": { dataUrl: "b" } }, replace: false },
    ],
  );
});

test("editor reports rejected asset resolution to the iframe", async (t) => {
  const { editor, iframe, posted, ready } = editorHarness(t, {
    onResolveAsset: async () => {
      throw new Error("asset missing");
    },
  });
  ready();
  posted.length = 0;
  const browser = iframe.ownerDocument.defaultView!;
  browser.dispatchEvent(
    new browser.MessageEvent("message", {
      source: iframe.contentWindow,
      data: {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "markdown-test",
        v: EDITOR_PROTOCOL_VERSION,
        type: "resolveAsset",
        payload: { requestId: 7, reference: "assets/missing.png" },
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    posted.find((message) => message.type === "assetResolved")?.payload,
    {
      requestId: 7,
      reference: "assets/missing.png",
      error: "asset missing",
    },
  );
  editor.destroy();
});

test("editor restores and reports view state only on its own channel", (t) => {
  const view = { anchor: 1, head: 2, scrollTop: 80 };
  const states: unknown[] = [];
  const { iframe, posted, ready } = editorHarness(t, {
    viewState: view,
    onViewState: (state) => states.push(state),
  });
  ready();
  assert.deepEqual(posted[0].payload.viewState, view);
  const host = iframe.ownerDocument.defaultView!;
  const report = (channel: string, payload: unknown) =>
    host.dispatchEvent(
      new host.MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          channel,
          v: EDITOR_PROTOCOL_VERSION,
          type: "viewState",
          payload,
        },
      }),
    );
  report("another-editor", view);
  report("markdown-test", { ...view, anchor: -1 });
  assert.deepEqual(states, []);
  report("markdown-test", view);
  assert.deepEqual(states, [view]);
});

test("appearance preferences reach pending and live editors and stop after destroy", (t) => {
  const { editor, posted, ready, fake } = editorHarness(t);
  const set = (name: string, value: string | number) =>
    fake.Zotero.Prefs.set(`extensions.zotero.bamboo.${name}`, value, true);
  set("theme", "dark");
  set("markdownFontFamily", "serif");
  set("markdownBackgroundColor", "#F7EFE0");
  set("fontSize", 18);
  applyMarkdownEditorPreferences();
  assert.equal(posted.length, 0);
  ready();
  const init = posted.find((message) => message.type === "init");
  assert.equal(init.payload.theme, "dark");
  assert.equal(init.payload.fontSize, 18);
  assert.deepEqual(init.payload.appearance, {
    fontFamily: "serif",
    backgroundColor: "#f7efe0",
  });
  assert.deepEqual(
    posted.findLast((message) => message.type === "setAppearance").payload,
    init.payload.appearance,
  );
  set("markdownFontFamily", "mono");
  set("markdownBackgroundColor", "");
  set("theme", "light");
  applyMarkdownEditorPreferences();
  assert.deepEqual(
    posted.findLast((message) => message.type === "setAppearance").payload,
    { fontFamily: "mono", backgroundColor: "" },
  );
  assert.equal(
    posted.findLast((message) => message.type === "setTheme").payload.theme,
    "light",
  );
  editor.destroy();
  const count = posted.length;
  applyMarkdownEditorPreferences();
  assert.equal(posted.length, count);
});
