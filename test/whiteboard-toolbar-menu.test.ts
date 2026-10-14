import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as paneCompatibility from "../src/compat/zotero-pane.ts";

type NativeWindow = Window & { ZoteroPane: Record<string, unknown> };
type CommandOptions = { win: NativeWindow; shouldOpen: () => boolean };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function fixture(t: TestContext) {
  const windows: NativeWindow[] = [];
  const libraries = new Map([
    [1, { editable: true, filesEditable: true }],
    [2, { editable: true, filesEditable: true }],
  ]);
  const collections = new Map([
    [101, { libraryID: 1 }],
    [202, { libraryID: 2 }],
  ]);
  const items = new Map<number, Record<string, unknown>>();
  const recent: number[] = [];
  const opened: Array<{ item: unknown; options: CommandOptions }> = [];
  const generated: CommandOptions[] = [];
  const remembered: number[] = [];
  let generating = async () => {};
  let opening = async () => "canvas-tab";
  const open = async (item: unknown, options: CommandOptions) => {
    opened.push({ item, options });
    return opening();
  };
  const context = {
    Zotero: {
      Libraries: { userLibraryID: 1, get: (id: number) => libraries.get(id) },
      Collections: { get: (id: number) => collections.get(id) },
      Items: { get: (id: number) => items.get(id) },
      getActiveZoteroPane: () => {
        throw new Error("A toolbar command must use its owning pane");
      },
    },
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
    },
    ztoolkit: { log: () => {} },
  };
  const whiteboardOpen = {
    rememberWhiteboard: (id: number) => remembered.push(id),
    recentWhiteboardIDs: () => recent,
  };
  const mocks: Record<string, unknown> = {
    "../compat/zotero-pane": paneCompatibility,
    "../../compat/zotero-pane": paneCompatibility,
    "../utils/locale": { getString: (key: string) => key },
    "../../utils/locale": { getString: (key: string) => key },
    "./markdown/create": { createMarkdownAttachment: async () => null },
    "./markdown/tab": { openMarkdownTab: open },
    "./markdown/detect": {
      isMarkdownAttachment: (item: Record<string, unknown>) =>
        String(item.attachmentFilename ?? "").endsWith(".md"),
    },
    "./markdown/transfer": { importMarkdownFile: async () => null },
    "./markdown/export-notes": { exportSelectedNotes: async () => null },
    "./whiteboard/create": { createWhiteboardAttachment: async () => null },
    "./whiteboard/tab": { openWhiteboardTab: open },
    "./whiteboard/open": whiteboardOpen,
    "./create": {
      createWhiteboardFromCollection: async (options: CommandOptions) => {
        generated.push(options);
        await generating();
      },
    },
    "./open": whiteboardOpen,
    "./tab": { openWhiteboardTab: open, openWhiteboardWindow: open },
    "./detect": {
      isWhiteboardAttachment: (item: Record<string, unknown>) =>
        String(item.attachmentFilename ?? "").endsWith(".canvas"),
    },
    "./tutorial": { createExampleWhiteboard: async () => {} },
    "../file-history-ui": {
      registerFileHistoryMenu: (_win: NativeWindow, popup: HTMLElement) => {
        const item = popup.ownerDocument.createElement("menuitem");
        item.id = "canvas-file-history";
        popup.append(item);
        return () => item.remove();
      },
    },
  };
  function load(path: string) {
    const module = { exports: {} as Record<string, unknown> };
    const { outputText } = transpileModule(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ModuleKind.CommonJS,
          target: ScriptTarget.ES2022,
        },
      },
    );
    runInNewContext(outputText, {
      ...context,
      module,
      exports: module.exports,
      require: (name: string) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        throw new Error(`Unexpected toolbar menu dependency: ${name}`);
      },
    });
    return module.exports;
  }
  const toolbar = load("../src/modules/creation-toolbar.ts") as {
    registerCreationToolbar(win: NativeWindow): void;
    unregisterCreationToolbar(win: NativeWindow): void;
  };
  const menu = load("../src/modules/whiteboard/menu.ts") as {
    registerWhiteboardMenus(win: NativeWindow): void;
    unregisterWhiteboardMenus(win: NativeWindow): void;
  };
  function makeWindow(libraryID = 1, legacy = false) {
    const win = new Window({ url: "https://zotero.test" }) as NativeWindow;
    windows.push(win);
    const doc = win.document;
    doc.body.innerHTML =
      '<menupopup id="menu_ToolsPopup"><menuitem id="native-tools"></menuitem></menupopup><menupopup id="menu_HelpPopup"></menupopup><menupopup id="zotero-itemmenu"></menupopup><div id="zotero-items-toolbar"><toolbarbutton id="zotero-tb-note-add"></toolbarbutton></div>';
    Object.assign(doc, { createXULElement: doc.createElement.bind(doc) });
    win.ZoteroPane = {
      getSelectedItems: () => [],
      selectItem: async () => {},
      ...(legacy
        ? {
            getSelectedLibraryID: () => libraryID,
            getSelectedCollection: () => (libraryID === 1 ? 101 : 202),
          }
        : {
            getSelectedLibraryIDs: () => [libraryID],
            getSelectedCollections: () => [libraryID === 1 ? 101 : 202],
          }),
    };
    return win;
  }
  const command = (win: NativeWindow, id: string) =>
    win.document.getElementById(id)!.dispatchEvent(new win.Event("command"));
  const popup = (win: NativeWindow) =>
    win.document
      .getElementById("bamboo-create-document")!
      .querySelector("menupopup")!;
  const show = (win: NativeWindow, element: Element) =>
    element.dispatchEvent(new win.Event("popupshowing", { bubbles: true }));
  t.after(() => {
    for (const win of windows) {
      menu.unregisterWhiteboardMenus(win);
      toolbar.unregisterCreationToolbar(win);
      win.close();
    }
  });
  return {
    ...toolbar,
    ...menu,
    makeWindow,
    command,
    popup,
    show,
    libraries,
    items,
    recent,
    opened,
    generated,
    remembered,
    setGenerating(value: () => Promise<void>) {
      generating = value;
    },
    setOpening(value: () => Promise<string>) {
      opening = value;
    },
  };
}

test("toolbar keeps the two primary actions and owns secondary whiteboard commands without Tools duplicates", (t) => {
  const f = fixture(t);
  const win = f.makeWindow();
  f.registerCreationToolbar(win);
  f.registerWhiteboardMenus(win);
  f.registerWhiteboardMenus(win);
  assert.deepEqual(
    Array.from(f.popup(win).children, (item) => item.id),
    [
      "bamboo-create-markdown",
      "bamboo-create-whiteboard",
      "bamboo-markdown-transfer-separator",
      "bamboo-import-markdown",
      "bamboo-export-markdown",
      "bamboo-toolbar-whiteboard-separator",
      "bamboo-toolbar-whiteboard-collection",
      "bamboo-toolbar-whiteboard-recent",
    ],
  );
  assert.equal(
    win.document.getElementById("menu_ToolsPopup")!.children.length,
    1,
  );
  assert.equal(
    win.document.querySelectorAll("#menu_HelpPopup > menuitem").length,
    1,
  );
  assert.ok(win.document.getElementById("canvas-file-history"));
  assert.ok(win.document.getElementById("bamboo-item-open-canvas"));
  assert.ok(win.document.getElementById("bamboo-item-open-canvas-window"));
  f.unregisterWhiteboardMenus(win);
  assert.equal(f.popup(win).children.length, 5);
  assert.equal(
    win.document.getElementById("menu_HelpPopup")!.children.length,
    0,
  );
  assert.equal(
    win.document.getElementById("zotero-itemmenu")!.children.length,
    0,
  );
});

test("deferred and recreated native toolbars retain a single secondary menu set", async (t) => {
  const f = fixture(t);
  const win = f.makeWindow();
  f.registerWhiteboardMenus(win);
  f.registerCreationToolbar(win);
  await setImmediate();
  assert.equal(f.popup(win).children.length, 8);
  f.registerCreationToolbar(win);
  await setImmediate();
  assert.equal(f.popup(win).children.length, 8);
  assert.equal(
    win.document.querySelectorAll("#bamboo-toolbar-whiteboard-recent").length,
    1,
  );
  // Reverse unload order is safe and a disposed observer cannot reattach.
  f.unregisterCreationToolbar(win);
  f.unregisterWhiteboardMenus(win);
  f.registerCreationToolbar(win);
  await setImmediate();
  assert.equal(f.popup(win).children.length, 5);
});

test("collection commands use each window's selection and disable readonly libraries", async (t) => {
  const f = fixture(t);
  const first = f.makeWindow(1);
  const second = f.makeWindow(2, true);
  for (const win of [first, second]) {
    f.registerCreationToolbar(win);
    f.registerWhiteboardMenus(win);
    f.show(win, f.popup(win));
    f.command(win, "bamboo-toolbar-whiteboard-collection");
  }
  await setImmediate();
  assert.equal(f.generated.length, 2);
  assert.equal(f.generated[0].win, first);
  assert.equal(f.generated[1].win, second);
  f.libraries.get(2)!.filesEditable = false;
  f.show(second, f.popup(second));
  assert.equal(
    second.document
      .getElementById("bamboo-toolbar-whiteboard-collection")!
      .getAttribute("disabled"),
    "true",
  );
  f.command(second, "bamboo-toolbar-whiteboard-collection");
  assert.equal(f.generated.length, 2);
});

test("repeated collection commands are blocked while creating and cannot reopen after cleanup", async (t) => {
  const f = fixture(t);
  const wait = deferred();
  f.setGenerating(() => wait.promise);
  const win = f.makeWindow();
  f.registerCreationToolbar(win);
  f.registerWhiteboardMenus(win);
  f.command(win, "bamboo-toolbar-whiteboard-collection");
  f.command(win, "bamboo-toolbar-whiteboard-collection");
  assert.equal(f.generated.length, 1);
  assert.equal(f.generated[0].shouldOpen(), true);
  f.unregisterWhiteboardMenus(win);
  assert.equal(f.generated[0].shouldOpen(), false);
  wait.resolve();
  await setImmediate();
  assert.equal(f.popup(win).children.length, 5);
});

test("recent boards open in their source window and skip deleted or unsupported items", async (t) => {
  const f = fixture(t);
  const first = f.makeWindow(1);
  const second = f.makeWindow(2, true);
  const canvas = { id: 10, attachmentFilename: "Research.canvas" };
  f.items.set(10, canvas);
  f.items.set(11, {
    id: 11,
    attachmentFilename: "Deleted.canvas",
    deleted: true,
  });
  f.items.set(12, { id: 12, attachmentFilename: "Paper.pdf" });
  f.recent.push(10, 11, 12, 99);
  for (const win of [first, second]) {
    f.registerCreationToolbar(win);
    f.registerWhiteboardMenus(win);
    const popup = win.document.getElementById(
      "bamboo-toolbar-whiteboard-recent",
    )!.firstElementChild!;
    f.show(win, popup);
    assert.equal(popup.children.length, 1);
    popup.firstElementChild!.dispatchEvent(new win.Event("command"));
  }
  await setImmediate();
  assert.equal(f.opened[0].options.win, first);
  assert.equal(f.opened[1].options.win, second);
  assert.deepEqual(f.remembered, [10, 10]);
  f.unregisterWhiteboardMenus(first);
  assert.equal(f.popup(second).children.length, 8);
});

test("pending recent-board opens inherit disposal cancellation and do not update history", async (t) => {
  const f = fixture(t);
  const wait = deferred();
  f.setOpening(async () => {
    await wait.promise;
    return "canvas-tab";
  });
  const win = f.makeWindow();
  f.items.set(10, { id: 10, attachmentFilename: "Research.canvas" });
  f.recent.push(10);
  f.registerCreationToolbar(win);
  f.registerWhiteboardMenus(win);
  const popup = win.document.getElementById(
    "bamboo-toolbar-whiteboard-recent",
  )!.firstElementChild!;
  f.show(win, popup);
  popup.firstElementChild!.dispatchEvent(new win.Event("command"));
  f.unregisterCreationToolbar(win);
  f.unregisterWhiteboardMenus(win);
  assert.equal(f.opened[0].options.shouldOpen(), false);
  wait.resolve();
  await setImmediate();
  assert.deepEqual(f.remembered, []);
});
