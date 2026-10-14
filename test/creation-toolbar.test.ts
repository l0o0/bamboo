import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

type DocumentKind = "markdown" | "whiteboard";
type Library = { libraryID: number; editable: boolean; filesEditable: boolean };
type Item = {
  id: number;
  libraryID: number;
  parentItem?: Item;
  parentItemID?: number;
  isRegularItem(): boolean;
  isAttachment(): boolean;
  isNote(): boolean;
  isAnnotation(): boolean;
};
type NativeWindow = Window & {
  ZoteroPane: Record<string, unknown>;
};
type CreateCall = {
  kind: DocumentKind;
  parent: Item | null | undefined;
  options: Record<string, unknown>;
};

const sourcePath = fileURLToPath(
  new URL("../src/modules/creation-toolbar.ts", import.meta.url),
);

function item(
  id: number,
  libraryID = 1,
  kind: "regular" | "attachment" | "note" | "annotation" = "regular",
  parentItem?: Item,
): Item {
  return {
    id,
    libraryID,
    parentItem,
    parentItemID: parentItem?.id,
    isRegularItem: () => kind === "regular",
    isAttachment: () => kind === "attachment",
    isNote: () => kind === "note",
    isAnnotation: () => kind === "annotation",
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, rejectPromise) => {
    resolvePromise = resolve;
    reject = rejectPromise;
  });
  return { promise, resolve: resolvePromise, reject };
}

function setup(t: TestContext) {
  const windows: NativeWindow[] = [];
  const libraries = new Map<number, Library>([
    [1, { libraryID: 1, editable: true, filesEditable: true }],
    [2, { libraryID: 2, editable: true, filesEditable: true }],
  ]);
  const collections = new Map<
    number,
    { id: number; libraryID: number; deleted?: boolean }
  >([
    [101, { id: 101, libraryID: 1 }],
    [203, { id: 203, libraryID: 2 }],
    [299, { id: 299, libraryID: 2 }],
  ]);
  const items = new Map<number, Item>();
  const calls: CreateCall[] = [];
  const opened: Array<{
    kind: DocumentKind;
    attachment: Item;
    win: NativeWindow;
  }> = [];
  const reports: unknown[][] = [];
  const transfers: Array<{ kind: string; win: NativeWindow; value: unknown }> =
    [];
  const observers = new Map<
    string,
    { notify: (...args: unknown[]) => unknown }
  >();
  let nextObserverID = 0;
  let nextItemID = 1000;
  let createResult: ((call: CreateCall) => Promise<Item | null>) | undefined;
  const create = async (
    kind: DocumentKind,
    parent: Item | null | undefined,
    options: Record<string, unknown>,
  ) => {
    const call = { kind, parent, options };
    calls.push(call);
    if (createResult) return createResult(call);
    const attachment = item(
      ++nextItemID,
      parent?.libraryID ?? Number(options.libraryID ?? 1),
      "attachment",
      parent ?? undefined,
    );
    items.set(attachment.id, attachment);
    return attachment;
  };
  const open = async (
    kind: DocumentKind,
    attachment: Item,
    options: { win: NativeWindow },
  ) => {
    opened.push({ kind, attachment, win: options.win });
    return `${kind}-${attachment.id}`;
  };

  const Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: {
      userLibraryID: 1,
      get: (id: number) => libraries.get(id),
    },
    Items: { get: (id: number) => items.get(id) },
    Collections: {
      get: (id: number) => collections.get(id),
    },
    Notifier: {
      registerObserver(observer: { notify: (...args: unknown[]) => unknown }) {
        const id = `observer-${++nextObserverID}`;
        observers.set(id, observer);
        return id;
      },
      unregisterObserver(id: string) {
        observers.delete(id);
      },
    },
    // Deliberately points elsewhere: each button must retain its owning pane.
    getActiveZoteroPane: () => ({
      getSelectedItems: () => [item(999, 2)],
      getSelectedLibraryIDs: () => [2],
      getSelectedCollections: () => [299],
    }),
    getMainWindows: () => windows,
    logError: (...args: unknown[]) => reports.push(args),
  };
  class ProgressWindow {
    createLine() {
      return this;
    }
    show() {
      return this;
    }
  }
  const mocks: Record<string, unknown> = {
    "../utils/locale": { getString: (key: string) => key },
    "./markdown/create": {
      createMarkdownAttachment: (
        parent: Item,
        options: Record<string, unknown>,
      ) => create("markdown", parent, options),
    },
    "./whiteboard/create": {
      createWhiteboardAttachment: (
        parent: Item,
        options: Record<string, unknown>,
      ) => create("whiteboard", parent, options),
    },
    "./markdown/tab": {
      openMarkdownTab: (attachment: Item, options: { win: NativeWindow }) =>
        open("markdown", attachment, options),
    },
    "./whiteboard/tab": {
      openWhiteboardTab: (attachment: Item, options: { win: NativeWindow }) =>
        open("whiteboard", attachment, options),
    },
    "./whiteboard/open": { rememberWhiteboard: () => {} },
    "./markdown/transfer": {
      importMarkdownFile: async (win: NativeWindow, target: unknown) => {
        transfers.push({ kind: "import", win, value: target });
        return null;
      },
    },
    "./markdown/export-notes": {
      exportSelectedNotes: async (win: NativeWindow, items: unknown) => {
        transfers.push({ kind: "export", win, value: items });
        return null;
      },
    },
  };
  const context = {
    Zotero,
    addon: {
      data: {
        alive: true,
        config: { addonRef: "bamboo", addonName: "Scholar Sketch" },
      },
    },
    ztoolkit: {
      log: (...args: unknown[]) => reports.push(args),
      ProgressWindow,
    },
    console,
    setTimeout,
    clearTimeout,
  };
  const loaded = new Map<string, Record<string, unknown>>();
  function loadModule(path: string): Record<string, unknown> {
    const cached = loaded.get(path);
    if (cached) return cached;
    const module = { exports: {} as Record<string, unknown> };
    loaded.set(path, module.exports);
    const { outputText } = transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: path,
    });
    runInNewContext(outputText, {
      ...context,
      module,
      exports: module.exports,
      require: (name: string) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        // Load the real compatibility helpers, rather than reimplementing
        // singular/plural selection behavior in the host fixture.
        if (name === "../compat/zotero-pane" || name === "./markdown/detect") {
          return loadModule(resolve(dirname(path), `${name}.ts`));
        }
        throw new Error(`Unexpected toolbar dependency: ${name}`);
      },
    });
    loaded.set(path, module.exports);
    return module.exports;
  }
  const toolbar = loadModule(sourcePath) as {
    registerCreationToolbar(win: NativeWindow): void;
    unregisterCreationToolbar(win: NativeWindow): void;
    unregisterAllCreationToolbars(): void;
  };

  function makeWindow(options: { legacy?: boolean } = {}) {
    const win = new Window({ url: "https://zotero.test" }) as NativeWindow;
    windows.push(win);
    const doc = win.document;
    Object.defineProperty(doc, "createXULElement", {
      value: (name: string) => doc.createElement(name),
    });
    doc.body.innerHTML = `
      <toolbar id="zotero-items-toolbar">
        <toolbarbutton id="zotero-tb-note-add" tabindex="-1">
          <menupopup id="native-note-menu"><menuitem id="native-note-item"></menuitem></menupopup>
        </toolbarbutton>
        <toolbarbutton id="native-next-button"></toolbarbutton>
        <toolbarbutton id="zotero-tb-search" tabindex="-1"></toolbarbutton>
      </toolbar>`;
    const selection = {
      items: [] as Item[],
      libraryID: 1,
      collectionID: null as number | null,
      libraryIDs: undefined as number[] | undefined,
      collectionIDs: undefined as number[] | undefined,
    };
    const selected: number[] = [];
    const listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
    const view = {
      addListener(name: string, callback: (...args: unknown[]) => unknown) {
        const callbacks = listeners.get(name) ?? new Set();
        callbacks.add(callback);
        listeners.set(name, callbacks);
      },
      removeListener(name: string, callback: (...args: unknown[]) => unknown) {
        listeners.get(name)?.delete(callback);
      },
    };
    const pane = {
      getSelectedItems: () => selection.items,
      selectItem: async (id: number) => {
        selected.push(id);
      },
      itemsView: view,
      collectionsView: view,
      ...(options.legacy
        ? {
            getSelectedLibraryID: () => selection.libraryID,
            getSelectedCollection: () => selection.collectionID,
          }
        : {
            getSelectedLibraryIDs: () =>
              selection.libraryIDs ?? [selection.libraryID],
            getSelectedCollections: () =>
              selection.collectionIDs ??
              (selection.collectionID == null ? [] : [selection.collectionID]),
          }),
    };
    Object.defineProperty(win, "ZoteroPane", {
      value: pane,
      configurable: true,
    });
    return { win, selection, selected, listeners };
  }

  t.after(() => {
    toolbar.unregisterAllCreationToolbars();
    for (const win of windows) win.close();
  });
  return {
    ...toolbar,
    makeWindow,
    libraries,
    collections,
    items,
    calls,
    opened,
    reports,
    transfers,
    observers,
    setCreateResult: (value: typeof createResult) => {
      createResult = value;
    },
  };
}

function menuItem(win: NativeWindow, kind: DocumentKind) {
  const element = win.document.getElementById(`bamboo-create-${kind}`);
  assert.ok(element, `${kind} creation entry is present`);
  return element;
}

function showPopup(win: NativeWindow) {
  const popup = win.document.querySelector("#bamboo-create-document menupopup");
  assert.ok(popup);
  popup.dispatchEvent(new win.Event("popupshowing", { bubbles: true }));
}

async function command(win: NativeWindow, kind: DocumentKind) {
  menuItem(win, kind).dispatchEvent(
    new win.Event("command", { bubbles: true }),
  );
  await setImmediate();
  await setImmediate();
}

test("mounts one native dropdown after the note button without changing its menu", (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  const nativeNote = win.document.getElementById("zotero-tb-note-add");
  const nativeContents = nativeNote?.innerHTML;
  fixture.registerCreationToolbar(win);
  fixture.registerCreationToolbar(win);
  assert.equal(
    win.document.querySelectorAll("#bamboo-create-document-style").length,
    1,
  );
  const buttons = win.document.querySelectorAll("#bamboo-create-document");
  assert.equal(buttons.length, 1);
  const button = buttons[0];
  assert.equal(button.localName, "toolbarbutton");
  assert.equal(button.getAttribute("type"), "menu");
  assert.equal(button.hasAttribute("label"), false);
  assert.match(
    button.getAttribute("image") ?? "",
    /scholar-sketch-toolbar\.svg$/,
  );
  assert.equal(button.previousElementSibling, nativeNote);
  assert.equal(button.nextElementSibling?.id, "native-next-button");
  assert.equal(button.querySelectorAll("menupopup").length, 1);
  assert.equal(button.querySelectorAll("menuitem").length, 4);
  assert.equal(nativeNote?.innerHTML, nativeContents);
  assert.equal(menuItem(win, "markdown").parentElement?.localName, "menupopup");
  assert.equal(
    menuItem(win, "whiteboard").parentElement?.localName,
    "menupopup",
  );
});

test("each document command creates, selects and opens in its owning window", async (t) => {
  const fixture = setup(t);
  const first = fixture.makeWindow();
  const second = fixture.makeWindow();
  second.selection.libraryID = 2;
  second.selection.collectionID = 203;
  fixture.registerCreationToolbar(first.win);
  fixture.registerCreationToolbar(second.win);
  await command(first.win, "markdown");
  await command(second.win, "whiteboard");
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].kind, "markdown");
  assert.equal(fixture.calls[0].options.open, false);
  assert.equal(fixture.calls[0].options.silent, true);
  assert.equal(fixture.calls[0].options.libraryID, 1);
  assert.equal(fixture.calls[0].options.collectionID, null);
  assert.equal(fixture.calls[1].kind, "whiteboard");
  assert.equal(fixture.calls[1].options.select, false);
  assert.equal(fixture.calls[1].options.reportError, false);
  assert.equal(fixture.calls[1].options.libraryID, 2);
  assert.deepEqual(
    Array.from(fixture.calls[1].options.collections as number[]),
    [203],
  );
  assert.deepEqual(
    fixture.opened.map(({ kind }) => kind),
    ["markdown", "whiteboard"],
  );
  assert.equal(fixture.opened[0].win, first.win);
  assert.equal(fixture.opened[1].win, second.win);
  assert.deepEqual(first.selected, [fixture.opened[0].attachment.id]);
  assert.deepEqual(second.selected, [fixture.opened[1].attachment.id]);
});

test("single regular items and their attachment or note resolve to a regular parent", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  const parent = item(41, 2);
  fixture.items.set(parent.id, parent);
  fixture.registerCreationToolbar(win);
  for (const selected of [
    parent,
    item(42, 2, "attachment", parent),
    item(43, 2, "note", parent),
  ]) {
    selection.items = [selected];
    await command(win, "markdown");
    assert.equal(fixture.calls.at(-1)?.parent, parent);
    assert.equal(fixture.calls.at(-1)?.options.libraryID, 2);
  }
});

test("no or multiple selections create standalone documents in the current collection on both pane APIs", async (t) => {
  const fixture = setup(t);
  for (const legacy of [true, false]) {
    const { win, selection } = fixture.makeWindow({ legacy });
    selection.libraryID = 2;
    selection.collectionID = 203;
    fixture.registerCreationToolbar(win);
    for (const selectedItems of [[], [item(11), item(12)]]) {
      selection.items = selectedItems;
      for (const kind of ["markdown", "whiteboard"] as const) {
        await command(win, kind);
        const call = fixture.calls.at(-1)!;
        assert.equal(call.parent == null, true);
        assert.equal(call.options.libraryID, 2);
        if (kind === "markdown") assert.equal(call.options.collectionID, 203);
        else
          assert.deepEqual(
            Array.from(call.options.collections as number[]),
            [203],
          );
      }
    }
  }
});

test("standalone library-root creation passes explicit empty collection targets", async (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  fixture.registerCreationToolbar(win);
  await command(win, "markdown");
  await command(win, "whiteboard");
  assert.equal(fixture.calls[0].options.collectionID, null);
  assert.deepEqual(
    Array.from(fixture.calls[1].options.collections as number[]),
    [],
  );
});

test("cross-library collection selections choose a collection in the target library", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  // Library IDs follow tree order while collection IDs follow selection order.
  selection.libraryIDs = [1, 2];
  selection.collectionIDs = [203, 101];
  fixture.registerCreationToolbar(win);
  await command(win, "markdown");
  await command(win, "whiteboard");
  assert.equal(fixture.calls[0].options.libraryID, 1);
  assert.equal(fixture.calls[0].options.collectionID, 101);
  assert.equal(fixture.calls[1].options.libraryID, 1);
  assert.deepEqual(
    Array.from(fixture.calls[1].options.collections as number[]),
    [101],
  );
});

test("missing, deleted or foreign collection selections fall back to the target library root", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  fixture.collections.set(102, { id: 102, libraryID: 1, deleted: true });
  selection.libraryIDs = [1, 2];
  fixture.registerCreationToolbar(win);
  for (const selectedCollections of [[203], [999], [102], [0, -1, NaN]]) {
    selection.collectionIDs = selectedCollections;
    await command(win, "markdown");
    await command(win, "whiteboard");
    const markdown = fixture.calls.at(-2)!;
    const whiteboard = fixture.calls.at(-1)!;
    assert.equal(markdown.options.libraryID, 1);
    assert.equal(markdown.options.collectionID, null);
    assert.equal(whiteboard.options.libraryID, 1);
    assert.deepEqual(
      Array.from(whiteboard.options.collections as number[]),
      [],
    );
  }
});

test("collection selection skips invalid entries before an eligible collection", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  fixture.collections.set(102, { id: 102, libraryID: 1, deleted: true });
  selection.libraryIDs = [1, 2];
  selection.collectionIDs = [0, 999, 102, 203, 101];
  fixture.registerCreationToolbar(win);
  await command(win, "markdown");
  assert.equal(fixture.calls[0].options.collectionID, 101);
});

test("read-only or file-read-only libraries disable both entries and reject direct commands", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  selection.libraryID = 2;
  fixture.registerCreationToolbar(win);
  for (const permissions of [
    { editable: false, filesEditable: true },
    { editable: true, filesEditable: false },
  ]) {
    fixture.libraries.set(2, { libraryID: 2, ...permissions });
    showPopup(win);
    for (const kind of ["markdown", "whiteboard"] as const) {
      assert.equal(menuItem(win, kind).getAttribute("disabled"), "true");
      await command(win, kind);
    }
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.opened.length, 0);
  fixture.libraries.set(2, {
    libraryID: 2,
    editable: true,
    filesEditable: true,
  });
  showPopup(win);
  assert.notEqual(menuItem(win, "markdown").getAttribute("disabled"), "true");
  await command(win, "markdown");
  assert.equal(fixture.calls.length, 1);
});

test("command rechecks changed permissions and the selected parent's library", async (t) => {
  const fixture = setup(t);
  const { win, selection } = fixture.makeWindow();
  fixture.registerCreationToolbar(win);
  showPopup(win);
  fixture.libraries.set(1, {
    libraryID: 1,
    editable: true,
    filesEditable: false,
  });
  await command(win, "markdown");
  assert.equal(fixture.calls.length, 0);
  fixture.libraries.set(1, {
    libraryID: 1,
    editable: true,
    filesEditable: true,
  });
  fixture.libraries.set(2, {
    libraryID: 2,
    editable: false,
    filesEditable: false,
  });
  selection.items = [item(40, 2)];
  await command(win, "whiteboard");
  assert.equal(fixture.calls.length, 0);
});

test("a pending creation blocks duplicate document commands and retains its initial target", async (t) => {
  const fixture = setup(t);
  const { win, selection, selected } = fixture.makeWindow();
  const pending = deferred<Item | null>();
  fixture.setCreateResult(() => pending.promise);
  selection.libraryID = 2;
  selection.collectionID = 203;
  fixture.registerCreationToolbar(win);
  await command(win, "markdown");
  selection.libraryID = 1;
  selection.collectionID = 101;
  await command(win, "markdown");
  await command(win, "whiteboard");
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].options.libraryID, 2);
  assert.equal(fixture.calls[0].options.collectionID, 203);
  const attachment = item(1234, 2, "attachment");
  pending.resolve(attachment);
  await setImmediate();
  await setImmediate();
  assert.deepEqual(selected, [1234]);
  assert.equal(fixture.opened[0].win, win);
  fixture.setCreateResult(undefined);
  await command(win, "whiteboard");
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].options.libraryID, 1);
});

test("a pending creation in one window does not block another window", async (t) => {
  const fixture = setup(t);
  const first = fixture.makeWindow();
  const second = fixture.makeWindow();
  const pending = deferred<Item | null>();
  fixture.setCreateResult((call) =>
    call.kind === "markdown"
      ? pending.promise
      : Promise.resolve(item(2001, 2, "attachment")),
  );
  fixture.registerCreationToolbar(first.win);
  fixture.registerCreationToolbar(second.win);
  await command(first.win, "markdown");
  await command(second.win, "whiteboard");
  assert.deepEqual(
    fixture.calls.map(({ kind }) => kind),
    ["markdown", "whiteboard"],
  );
  assert.equal(fixture.opened.length, 1);
  assert.equal(fixture.opened[0].win, second.win);
  pending.resolve(item(2002, 1, "attachment"));
  await setImmediate();
  await setImmediate();
  assert.equal(fixture.opened[1].win, first.win);
});

test("failed or null creation does not open and releases the busy state for retry", async (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  fixture.registerCreationToolbar(win);
  fixture.setCreateResult(async () => {
    throw new Error("disk full");
  });
  await command(win, "markdown");
  assert.equal(fixture.opened.length, 0);
  fixture.setCreateResult(async () => null);
  await command(win, "whiteboard");
  assert.equal(fixture.opened.length, 0);
  fixture.setCreateResult(undefined);
  await command(win, "markdown");
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.opened.length, 1);
});

test("unregister and hot reload detach old commands without affecting another window", async (t) => {
  const fixture = setup(t);
  const first = fixture.makeWindow();
  const second = fixture.makeWindow();
  fixture.registerCreationToolbar(first.win);
  fixture.registerCreationToolbar(second.win);
  const oldEntry = menuItem(first.win, "markdown");
  fixture.unregisterCreationToolbar(first.win);
  assert.equal(
    first.win.document.getElementById("bamboo-create-document"),
    null,
  );
  assert.equal(
    first.win.document.getElementById("bamboo-create-document-style"),
    null,
  );
  assert.ok(second.win.document.getElementById("bamboo-create-document-style"));
  oldEntry.dispatchEvent(new first.win.Event("command"));
  await setImmediate();
  assert.equal(fixture.calls.length, 0);
  await command(second.win, "whiteboard");
  assert.equal(fixture.calls.length, 1);
  fixture.registerCreationToolbar(first.win);
  await command(first.win, "markdown");
  assert.equal(fixture.calls.length, 2);
  fixture.unregisterAllCreationToolbars();
  assert.equal(
    first.win.document.getElementById("bamboo-create-document"),
    null,
  );
  assert.equal(
    second.win.document.getElementById("bamboo-create-document"),
    null,
  );
  assert.equal(
    first.win.document.getElementById("bamboo-create-document-style"),
    null,
  );
  assert.equal(
    second.win.document.getElementById("bamboo-create-document-style"),
    null,
  );
  assert.equal(fixture.observers.size, 0);
  for (const host of [first, second]) {
    for (const callbacks of host.listeners.values())
      assert.equal(callbacks.size, 0);
  }
});

test("window teardown prevents a pending result from selecting or opening in a disposed host", async (t) => {
  const fixture = setup(t);
  const { win, selected } = fixture.makeWindow();
  const pending = deferred<Item | null>();
  fixture.setCreateResult(() => pending.promise);
  fixture.registerCreationToolbar(win);
  await command(win, "markdown");
  win.dispatchEvent(new win.Event("unload"));
  pending.resolve(item(1001, 1, "attachment"));
  await setImmediate();
  await setImmediate();
  assert.equal(win.document.getElementById("bamboo-create-document"), null);
  assert.equal(
    win.document.getElementById("bamboo-create-document-style"),
    null,
  );
  assert.deepEqual(selected, []);
  assert.equal(fixture.opened.length, 0);
});

test("iframe unload leaves the toolbar usable but document unload removes it", async (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  fixture.registerCreationToolbar(win);
  const frame = win.document.createElement("iframe");
  win.document.body.append(frame);
  frame.dispatchEvent(new win.Event("unload", { bubbles: true }));
  assert.ok(win.document.getElementById("bamboo-create-document"));
  await command(win, "markdown");
  assert.equal(fixture.calls.length, 1);
  win.document.dispatchEvent(new win.Event("unload", { bubbles: true }));
  assert.equal(win.document.getElementById("bamboo-create-document"), null);
  assert.equal(
    win.document.getElementById("bamboo-create-document-style"),
    null,
  );
});

test("native keyboard navigation reaches and leaves the new button and is removed on teardown", (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  fixture.registerCreationToolbar(win);
  const anchor = win.document.getElementById("zotero-tb-note-add")!;
  const button = win.document.getElementById("bamboo-create-document")!;
  const search = win.document.getElementById("zotero-tb-search")!;
  const key = (element: typeof button, value: string, shiftKey = false) => {
    const event = new win.KeyboardEvent("keydown", {
      key: value,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event;
  };
  anchor.focus();
  assert.equal(key(anchor, "ArrowRight").defaultPrevented, true);
  assert.equal(win.document.activeElement, button);
  assert.equal(key(button, "ArrowLeft").defaultPrevented, true);
  assert.equal(win.document.activeElement, anchor);
  button.focus();
  assert.equal(key(button, "Tab").defaultPrevented, true);
  assert.equal(win.document.activeElement, search);
  button.focus();
  assert.equal(key(button, "Tab", true).defaultPrevented, true);
  assert.equal(win.document.activeElement, anchor);
  fixture.unregisterCreationToolbar(win);
  const event = key(anchor, "ArrowRight");
  assert.equal(event.defaultPrevented, false);
  assert.equal(win.document.activeElement, anchor);
});

test("a window without the native item toolbar can register and unregister safely", (t) => {
  const fixture = setup(t);
  const { win } = fixture.makeWindow();
  win.document.getElementById("zotero-items-toolbar")?.remove();
  fixture.registerCreationToolbar(win);
  assert.equal(win.document.getElementById("bamboo-create-document"), null);
  fixture.unregisterCreationToolbar(win);
  fixture.unregisterAllCreationToolbars();
});

test("import and export use the owning window's captured target and Markdown selection", async (t) => {
  const f = setup(t);
  const first = f.makeWindow();
  const second = f.makeWindow();
  const parent = item(41, 2);
  first.selection.items = [parent];
  second.selection.libraryID = 2;
  second.selection.collectionID = 203;
  f.registerCreationToolbar(first.win);
  f.registerCreationToolbar(second.win);
  const transfer = async (win: NativeWindow, kind: "import" | "export") => {
    win.document
      .getElementById(`bamboo-${kind}-markdown`)!
      .dispatchEvent(new win.Event("command", { bubbles: true }));
    await setImmediate();
    await setImmediate();
  };
  await transfer(first.win, "import");
  await transfer(second.win, "import");
  assert.equal(f.transfers[0].win, first.win);
  assert.equal((f.transfers[0].value as { parent: Item }).parent, parent);
  assert.equal(f.transfers[1].win, second.win);
  assert.equal((f.transfers[1].value as { libraryID: number }).libraryID, 2);
  assert.equal(
    (f.transfers[1].value as { collectionID: number }).collectionID,
    203,
  );
  const firstNote = Object.assign(item(51, 2, "attachment", parent), {
    attachmentFilename: "First.md",
  });
  const secondNote = Object.assign(item(52, 2, "attachment"), {
    attachmentFilename: "Second.md",
  });
  first.selection.items = [firstNote];
  second.selection.items = [secondNote];
  showPopup(first.win);
  showPopup(second.win);
  assert.equal(
    first.win.document
      .getElementById("bamboo-export-markdown")!
      .hasAttribute("disabled"),
    false,
  );
  await transfer(first.win, "export");
  await transfer(second.win, "export");
  assert.equal(f.transfers[2].win, first.win);
  assert.deepEqual(Array.from(f.transfers[2].value as Item[]), [firstNote]);
  assert.equal(f.transfers[3].win, second.win);
  assert.deepEqual(Array.from(f.transfers[3].value as Item[]), [secondNote]);
  first.selection.items = [firstNote, parent];
  showPopup(first.win);
  assert.equal(
    first.win.document
      .getElementById("bamboo-export-markdown")!
      .getAttribute("disabled"),
    "true",
  );
  await transfer(first.win, "export");
  assert.equal(f.transfers.length, 4);
  f.libraries.get(2)!.filesEditable = false;
  showPopup(second.win);
  assert.equal(
    second.win.document
      .getElementById("bamboo-import-markdown")!
      .getAttribute("disabled"),
    "true",
  );
  await transfer(second.win, "import");
  assert.equal(f.transfers.length, 4);
});
