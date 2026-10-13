import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import path from "node:path";
import { FileConflictError } from "../src/modules/file-safety.ts";
import { WhiteboardSaveCoordinator } from "../src/modules/whiteboard/save-coordinator.ts";
import {
  createBasicNode,
  emptyCanvasDocument,
  type CanvasDocument,
} from "../src/modules/whiteboard/snapshot.ts";
import {
  parseStoredCanvas,
  serializeCanvasDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  type ParentToWhiteboardMessage,
  type WhiteboardToParentBody,
} from "../src/modules/whiteboard/protocol.ts";
import {
  closeWhiteboardSession,
  closeAllWhiteboards,
  openWhiteboardTab,
  openWhiteboardWindow,
  openWhiteboardSidebar,
} from "../src/modules/whiteboard/tab.ts";
import {
  whiteboardRegistry,
  type WhiteboardSession,
} from "../src/modules/whiteboard/session-registry.ts";
import { documentWorkspace } from "../src/modules/workspace-state.ts";

function setup(t: TestContext) {
  const win = new Window();
  const root = win.document.createElement("div");
  win.document.body.append(root);
  const calls: string[] = [];
  const item = {
    id: 501,
    isAttachment: () => true,
    attachmentFilename: "test.canvas",
    getFilePathAsync: async () => "/tmp/test.canvas",
  } as unknown as Zotero.Item;
  class ProgressWindow {
    createLine() {
      return this;
    }
    show() {
      calls.push("error");
      return this;
    }
  }
  const globals = {
    addon: {
      data: { config: { addonName: "Scholar Sketch", addonRef: "bamboo" } },
    },
    ztoolkit: { log: () => {}, ProgressWindow },
    Zotero: {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      getMainWindow: () => ({ openDialog: () => null }),
      File: {
        getContentsAsync: async () =>
          JSON.stringify({ version: 2, nodes: [], connections: [] }),
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const session = {
    tabID: "test-window",
    canvasId: "test",
    itemID: item.id,
    win: win as unknown as globalThis.Window,
    path: "/tmp/test.canvas",
    title: "Canvas",
    surface: "window",
    view: { root, host: root },
    editor: {
      destroy: () => calls.push("destroy"),
      focus: () => calls.push("focus"),
    },
    saveCoordinator: {
      request: async () => {
        calls.push("save");
      },
      flush: async () => {},
    },
    closeHost: () => calls.push("close"),
  } as unknown as WhiteboardSession;
  whiteboardRegistry.register(session);
  t.after(() => {
    whiteboardRegistry.unregister(session.tabID);
    win.close();
  });
  return { win, root, calls, item, session };
}

test("window close waits for the final save and coalesces repeated close requests", async (t) => {
  const { session, calls, root } = setup(t);
  let finish!: () => void;
  session.saveCoordinator!.request = () =>
    new Promise<void>((resolve) => {
      calls.push("save");
      finish = resolve;
    });
  const first = closeWhiteboardSession(session.tabID);
  assert.equal(closeWhiteboardSession(session.tabID), first);
  assert.deepEqual(calls, ["save"]);
  assert.equal(root.inert, true);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), session);
  finish();
  assert.equal(await first, true);
  assert.deepEqual(calls, ["save", "destroy", "close"]);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), undefined);
});

test("failed close preserves a usable window and can be retried", async (t) => {
  const { session, calls, root } = setup(t);
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), false);
  assert.deepEqual(calls, ["error"]);
  assert.equal(whiteboardRegistry.findByItem(session.itemID), session);
  assert.equal(root.inert, false);
  assert.equal(session.closing, undefined);
  session.saveCoordinator!.request = async () => {
    calls.push("save");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), true);
  assert.deepEqual(calls, ["error", "save", "destroy", "close"]);
});

test("reopening a Canvas focuses its standalone window without requiring Zotero tabs", async (t) => {
  const { session, item, calls } = setup(t);
  const ids = await Promise.all([
    openWhiteboardWindow(item),
    openWhiteboardWindow(item),
    openWhiteboardTab(item),
  ]);
  assert.deepEqual(ids, [session.tabID, session.tabID, session.tabID]);
  assert.deepEqual(calls, ["focus", "focus", "focus"]);
  assert.equal(whiteboardRegistry.all().length, 1);
});

test("failed transfer retains the source editor and releases its input lock", async (t) => {
  const { session, item, root, calls } = setup(t);
  session.surface = "tab";
  await assert.rejects(openWhiteboardWindow(item));
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.deepEqual(calls, ["save"]);
  assert.equal(session.transitioning, false);
  assert.equal(root.inert, false);
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  await assert.rejects(openWhiteboardWindow(item), /Disk full/);
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.equal(root.inert, false);
});

test("sidebar close saves even before dirty notification and never closes its host window", async (t) => {
  const { session, calls } = setup(t);
  session.surface = "sidebar";
  assert.equal(await closeWhiteboardSession(session.tabID), true);
  assert.deepEqual(calls, ["save", "destroy"]);
});

test("sidebar rendering does not steal an existing editor", async (t) => {
  const { session, item, win, root, calls } = setup(t);
  assert.equal(
    await openWhiteboardSidebar(item, win as never, root as never),
    null,
  );
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.deepEqual(calls, []);
});

test("failed sidebar save retains the editor and opening in a tab does not focus a nonexistent Zotero tab", async (t) => {
  const { session, item, root } = setup(t);
  session.surface = "sidebar";
  session.saveCoordinator!.request = async () => {
    throw new Error("Disk full");
  };
  assert.equal(await closeWhiteboardSession(session.tabID), false);
  await assert.rejects(openWhiteboardTab(item), /Disk full/);
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
  assert.equal(root.inert, false);
});

const serializeTransferDocument = (document: CanvasDocument) =>
  serializeCanvasDocument(document, { now: "2026-10-06T00:00:00.000Z" });

function transferDocument(title: string, count: number): CanvasDocument {
  return parseStoredCanvas(
    serializeTransferDocument({
      ...emptyCanvasDocument(),
      nodes: Array.from({ length: count }, (_, index) => ({
        ...createBasicNode("text", { x: index * 120, y: 32 }, `card-${index}`),
        data: { title: `${title} ${index}` },
      })),
    }),
  ).document;
}

interface TransferFrame {
  messages: ParentToWhiteboardMessage[];
  snapshot: CanvasDocument;
  rev: number;
}

/** Only the iframe peer is simulated; the production parent bridge still runs. */
function installTransferFrame(
  t: TestContext,
  win: Window,
  frames: TransferFrame[],
  beforeReady: () => void,
) {
  const createElement = win.document.createElement.bind(win.document);
  t.mock.method(win.document, "createElement", (tagName: string) => {
    const element = createElement(tagName);
    if (tagName.toLowerCase() !== "iframe") return element;
    const frame: TransferFrame = {
      messages: [],
      snapshot: emptyCanvasDocument(),
      rev: 0,
    };
    frames.push(frame);
    let channel = "";
    const emit = (body: WhiteboardToParentBody) =>
      win.dispatchEvent(
        new win.MessageEvent("message", {
          data: {
            source: WHITEBOARD_MESSAGE_SOURCE,
            v: WHITEBOARD_PROTOCOL_VERSION,
            channel,
            ...body,
          },
          // Zotero chrome supports the validated null-source protocol case.
          source: null,
        }),
      );
    const peer = {
      postMessage(message: ParentToWhiteboardMessage) {
        frame.messages.push(structuredClone(message));
        if (message.type === "init") {
          frame.snapshot = structuredClone(
            message.payload.snapshot ?? emptyCanvasDocument(),
          );
        } else if (message.type === "loadSnapshot") {
          frame.snapshot = structuredClone(message.payload.snapshot);
        } else if (message.type === "requestSnapshot") {
          queueMicrotask(() =>
            emit({
              type: "snapshot",
              payload: {
                requestId: message.payload.requestId,
                rev: frame.rev,
                snapshot: structuredClone(frame.snapshot),
              },
            }),
          );
        }
      },
    };
    Object.defineProperties(element, {
      contentWindow: { configurable: true, value: peer },
      contentDocument: { configurable: true, value: null },
    });
    queueMicrotask(() => {
      channel = new URL(element.getAttribute("src")!).searchParams.get(
        "channel",
      )!;
      beforeReady();
      emit({ type: "ready" });
    });
    return element;
  });
}

function setupTransfer(t: TestContext, conflict: boolean) {
  const main = new Window({ settings: { disableIframePageLoading: true } });
  const popup = new Window({ settings: { disableIframePageLoading: true } });
  const popupRoot = popup.document.createElement("div");
  popupRoot.id = "bamboo-whiteboard-window-root";
  popup.document.body.append(popupRoot);
  const oldRoot = main.document.createElement("div");
  main.document.body.append(oldRoot);
  const tabRecords = new Map<
    string,
    { id: string; title: string; container: unknown; onClose?: () => void }
  >();
  const nativeTabCloses: string[] = [];
  let nativeWindowCloses = 0;
  let tabSequence = 0;
  const tabs = {
    add(options: { title: string; onClose?: () => void }) {
      const container = main.document.createElement("div");
      main.document.body.append(container);
      const tab = {
        id: `transfer-tab-${tabSequence++}`,
        title: options.title,
        container,
        onClose: options.onClose,
      };
      tabRecords.set(tab.id, tab);
      return tab;
    },
    _getTab(id: string) {
      return { tab: tabRecords.get(id) };
    },
    _update() {},
    select() {},
    close(id: string) {
      const tab = tabRecords.get(id);
      nativeTabCloses.push(id);
      tabRecords.delete(id);
      tab?.onClose?.();
    },
  };
  // Happy DOM permits script close only for browser-created popup windows.
  // This peer models the native Zotero chrome host and its cancelable close.
  t.mock.method(popup, "close", () => {
    nativeWindowCloses += 1;
    if (
      !popup.dispatchEvent(
        new popup.Event("DOMWindowClose", { cancelable: true }),
      )
    )
      return;
    popup.closed = true;
    popup.document.dispatchEvent(new popup.Event("unload", { bubbles: true }));
  });
  Object.assign(main, { Zotero_Tabs: tabs, openDialog: () => popup });
  const item = {
    id: 601,
    key: "TRANSFER1",
    libraryID: 1,
    isAttachment: () => true,
    attachmentFilename: "transfer.canvas",
    getFilePathAsync: async () => "/tmp/transfer.canvas",
  } as unknown as Zotero.Item;
  const baseline = transferDocument("baseline", conflict ? 2 : 6);
  const draft = conflict ? transferDocument("local draft", 6) : baseline;
  const firstDisk = transferDocument("external first", 2);
  const latestDisk = transferDocument("external while loading", 3);
  const target = "/tmp/transfer.canvas";
  const files = new Map([[target, serializeTransferDocument(firstDisk)]]);
  const directories = new Set<string>();
  const prefs = new Map<string, unknown>();
  const frames: TransferFrame[] = [];
  const notifications: unknown[][] = [];
  let beforeDiskWrite: (() => Promise<void>) | undefined;
  let sourceWrites = 0,
    sourceSnapshots = 0,
    diskReads = 0,
    diskWrites = 0,
    destroys = 0,
    closes = 0;
  const read = async (filename: string) => {
    if (filename === target) diskReads += 1;
    if (!files.has(filename)) throw new Error("missing file");
    return files.get(filename)!;
  };
  const hostGlobals = {
    addon: {
      data: { config: { addonName: "Scholar Sketch", addonRef: "bamboo" } },
    },
    ztoolkit: {
      log() {},
      ProgressWindow: class {
        createLine() {
          return this;
        }
        show() {
          return this;
        }
      },
    },
    Zotero: {
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      getMainWindow: () => main,
      DataDirectory: { dir: "/tmp/transfer-history" },
      File: { getContentsAsync: read },
      Items: { get: () => item },
      Libraries: { userLibraryID: 1, get: () => null },
      SyncedSettings: { get: () => null, onSyncDownload: { addListener() {} } },
      Notifier: {
        async trigger(...args: unknown[]) {
          notifications.push(args);
        },
      },
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    },
    IOUtils: {
      exists: async (filename: string) =>
        files.has(filename) || directories.has(filename),
      readUTF8: read,
      getChildren: async (directory: string) =>
        [...files.keys()].filter(
          (filename) => path.dirname(filename) === directory,
        ),
      makeDirectory: async (directory: string) => {
        directories.add(directory);
      },
      writeUTF8: async (filename: string, content: string) => {
        if (filename === target) {
          await beforeDiskWrite?.();
          diskWrites += 1;
        }
        files.set(filename, content);
      },
      remove: async (filename: string) => {
        files.delete(filename);
      },
    },
    PathUtils: { join: path.join, parent: path.dirname },
  };
  // The production editor installs these sandbox globals when a window changes.
  const globalKeys = [
    ...Object.keys(hostGlobals),
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
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.assign(globalThis, hostGlobals);
  const revision = { content: serializeTransferDocument(baseline) };
  const editor = {
    async requestSnapshot() {
      sourceSnapshots += 1;
      return { rev: conflict ? 4 : 0, snapshot: draft };
    },
    destroy() {
      destroys += 1;
    },
    focus() {},
  };
  const save = new WhiteboardSaveCoordinator({
    initialDocument: baseline,
    getSnapshot: async () => {
      const shot = await editor.requestSnapshot();
      return { rev: shot.rev, document: shot.snapshot };
    },
    write: async () => {
      sourceWrites += 1;
      if (conflict) throw new FileConflictError();
      throw new Error("A clean source must not overwrite the external file");
    },
  });
  if (conflict) save.markChanged(4);
  const oldSession = {
    tabID: "transfer-source",
    canvasId: "transfer-source",
    itemID: item.id,
    win: main as unknown as globalThis.Window,
    path: target,
    title: "transfer.canvas",
    surface: "tab",
    fileRevision: revision,
    editor,
    saveCoordinator: save,
    view: { root: oldRoot, host: oldRoot },
    closeHost() {
      closes += 1;
    },
  } as unknown as WhiteboardSession;
  tabRecords.set(oldSession.tabID, {
    id: oldSession.tabID,
    title: oldSession.title,
    container: oldRoot,
  });
  whiteboardRegistry.register(oldSession);
  const beforeReady = () => {
    if (!conflict) files.set(target, serializeTransferDocument(latestDisk));
  };
  installTransferFrame(t, popup, frames, beforeReady);
  t.after(() => {
    for (const session of whiteboardRegistry.all()) {
      if (session.itemID !== item.id) continue;
      session.closing = true;
      session.unbindTheme?.();
      session.editor?.destroy();
      whiteboardRegistry.unregister(session.tabID);
    }
    main.close();
    popup.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    item,
    oldSession,
    draft,
    revision,
    firstDisk,
    latestDisk,
    frames,
    main,
    popup,
    tabs,
    nativeTabCloses,
    notifications,
    set beforeDiskWrite(callback: (() => Promise<void>) | undefined) {
      beforeDiskWrite = callback;
    },
    get disk() {
      return files.get(target)!;
    },
    get sourceWrites() {
      return sourceWrites;
    },
    get sourceSnapshots() {
      return sourceSnapshots;
    },
    get diskReads() {
      return diskReads;
    },
    get diskWrites() {
      return diskWrites;
    },
    get destroys() {
      return destroys;
    },
    get closes() {
      return closes;
    },
    get nativeWindowCloses() {
      return nativeWindowCloses;
    },
  };
}

test("tab to window migrates a six-node conflicting draft with its old baseline and unsaved state", async (t) => {
  const f = setupTransfer(t, true);
  const originalDisk = f.disk;
  const id = await openWhiteboardWindow(f.item);
  const destination = whiteboardRegistry.findByItem(f.item.id)!;
  assert.equal(id, destination.tabID);
  assert.equal(destination.surface, "window");
  assert.notEqual(destination, f.oldSession);
  assert.deepEqual(
    (await destination.editor!.requestSnapshot()).snapshot,
    f.draft,
  );
  assert.equal(f.frames[0].snapshot.nodes.length, 6);
  assert.deepEqual(destination.fileRevision, f.revision);
  assert.notEqual(destination.fileRevision, f.revision);
  assert.equal(destination.saveCoordinator!.dirty, true);
  assert.ok(
    destination.saveCoordinator!.lastError instanceof FileConflictError,
  );
  assert.equal(f.sourceWrites, 2, "both captures observe the source conflict");
  assert.equal(
    f.sourceSnapshots,
    4,
    "each conflict takes a fresh draft after the failed save",
  );
  assert.equal(
    f.diskReads,
    0,
    "conflict transfer must not replace the draft with disk content",
  );
  assert.equal(f.diskWrites, 0);
  assert.equal(f.disk, originalDisk);
  assert.equal(f.destroys, 1);
  assert.equal(f.closes, 1);
  assert.equal(destination.transitioning, false);
  assert.equal(destination.view!.root.inert, false);
  assert.ok(
    f.frames[0].messages.some(
      (message) =>
        message.type === "saveState" && message.payload.state === "error",
    ),
  );
  // The replacement's actual protected writer still rejects the external edit.
  await assert.rejects(
    destination.saveCoordinator!.request({ force: true }),
    (failure) => failure instanceof FileConflictError,
  );
  assert.equal(f.diskWrites, 0);
  assert.equal(f.disk, originalDisk);
  assert.equal(destination.saveCoordinator!.dirty, true);
  assert.equal(f.revision.content, destination.fileRevision!.content);
});

test("tab to window rereads an external update while the replacement iframe loads", async (t) => {
  const f = setupTransfer(t, false);
  await openWhiteboardWindow(f.item);
  const destination = whiteboardRegistry.findByItem(f.item.id)!;
  assert.equal(destination.surface, "window");
  const init = f.frames[0].messages.find((message) => message.type === "init");
  assert.ok(init && init.type === "init");
  assert.deepEqual(init.payload.snapshot, f.firstDisk);
  const loaded = f.frames[0].messages.find(
    (message) => message.type === "loadSnapshot",
  );
  assert.ok(loaded && loaded.type === "loadSnapshot");
  assert.deepEqual(loaded.payload.snapshot, f.latestDisk);
  assert.notDeepEqual(loaded.payload.snapshot, f.draft);
  assert.deepEqual(
    (await destination.editor!.requestSnapshot()).snapshot,
    f.latestDisk,
  );
  assert.deepEqual(destination.fileRevision, {
    content: serializeTransferDocument(f.latestDisk),
  });
  assert.equal(destination.saveCoordinator!.dirty, false);
  assert.equal(destination.saveCoordinator!.lastError, undefined);
  assert.equal(f.sourceWrites, 0);
  assert.equal(f.sourceSnapshots, 2);
  assert.equal(f.diskReads, 2);
  assert.equal(f.diskWrites, 0);
  assert.equal(f.destroys, 1);
  assert.equal(f.closes, 1);
  await destination.saveCoordinator!.request({ force: true });
  assert.equal(
    f.diskWrites,
    0,
    "the loaded fresh snapshot establishes the saved new-iframe epoch",
  );
  assert.equal(f.disk, serializeTransferDocument(f.latestDisk));
});

test("failed surface transfer cleans visibility subscriptions before the replacement tab is registered", async (t) => {
  const f = setupTransfer(t, false);
  f.oldSession.surface = "sidebar";
  installTransferFrame(t, f.main, f.frames, () => {});
  const originalDisk = f.disk;
  const observers = new Set<string>();
  const removedObservers: string[] = [];
  Object.assign(Zotero.Notifier, {
    registerObserver(_observer: unknown, types: string[], name: string) {
      assert.deepEqual(types, ["tab"]);
      assert.equal(name, "whiteboard-source-visibility");
      observers.add("replacement-visibility");
      return "replacement-visibility";
    },
    unregisterObserver(id: string) {
      removedObservers.push(id);
      observers.delete(id);
    },
  });

  const visibilityListeners = new Set<unknown>();
  const focusListeners = new Set<unknown>();
  const addDocumentListener = f.main.document.addEventListener.bind(
    f.main.document,
  );
  const removeDocumentListener = f.main.document.removeEventListener.bind(
    f.main.document,
  );
  const addWindowListener = f.main.addEventListener.bind(f.main);
  const removeWindowListener = f.main.removeEventListener.bind(f.main);
  t.mock.method(
    f.main.document,
    "addEventListener",
    (...args: Parameters<typeof f.main.document.addEventListener>) => {
      if (args[0] === "visibilitychange") visibilityListeners.add(args[1]);
      addDocumentListener(...args);
    },
  );
  t.mock.method(
    f.main.document,
    "removeEventListener",
    (...args: Parameters<typeof f.main.document.removeEventListener>) => {
      if (args[0] === "visibilitychange") visibilityListeners.delete(args[1]);
      removeDocumentListener(...args);
    },
  );
  t.mock.method(
    f.main,
    "addEventListener",
    (...args: Parameters<typeof f.main.addEventListener>) => {
      if (args[0] === "focus") focusListeners.add(args[1]);
      addWindowListener(...args);
    },
  );
  t.mock.method(
    f.main,
    "removeEventListener",
    (...args: Parameters<typeof f.main.removeEventListener>) => {
      if (args[0] === "focus") focusListeners.delete(args[1]);
      removeWindowListener(...args);
    },
  );
  const read = Zotero.File.getContentsAsync.bind(Zotero.File);
  let targetReads = 0;
  t.mock.method(Zotero.File, "getContentsAsync", async (...args) => {
    if (args[0] === f.oldSession.path && ++targetReads === 2) {
      assert.equal(f.frames.length, 1, "the replacement iframe is ready");
      assert.equal(whiteboardRegistry.get("transfer-tab-0"), undefined);
      assert.equal(observers.size, 1);
      assert.equal(visibilityListeners.size, 1);
      assert.equal(focusListeners.size, 1);
      throw new Error("Second transfer read failed");
    }
    return read(...args);
  });

  await assert.rejects(
    openWhiteboardTab(f.item),
    /Second transfer read failed/,
  );
  assert.equal(targetReads, 2);
  assert.deepEqual(removedObservers, ["replacement-visibility"]);
  assert.equal(observers.size, 0);
  assert.equal(visibilityListeners.size, 0);
  assert.equal(focusListeners.size, 0);
  assert.deepEqual(f.nativeTabCloses, ["transfer-tab-0"]);
  assert.deepEqual(whiteboardRegistry.all(), [f.oldSession]);
  assert.equal(f.oldSession.view!.root.isConnected, true);
  assert.equal(f.oldSession.view!.root.inert, false);
  assert.equal(f.oldSession.transitioning, false);
  assert.equal(f.destroys, 0);
  assert.equal(f.closes, 0);
  assert.deepEqual(
    (await f.oldSession.editor!.requestSnapshot()).snapshot,
    f.draft,
  );
  await f.oldSession.saveCoordinator!.request({ force: true });
  assert.equal(f.sourceWrites, 0);
  assert.equal(f.diskWrites, 0);
  assert.equal(f.disk, originalDisk);
});

test(
  "DOMWindowClose cancels native close until its final snapshot is saved, then closes and refreshes the sidebar",
  { timeout: 2000 },
  async (t) => {
    const f = setupTransfer(t, false);
    await openWhiteboardWindow(f.item);
    const session = whiteboardRegistry.findByItem(f.item.id)!;
    const root = session.view!.root;
    const originalDisk = f.disk;
    const draft = transferDocument("last edit before close", 6);
    f.frames[0].snapshot = draft;
    f.frames[0].rev = 1;
    // No onChange notification: native close must request the actual final draft.
    let entered!: () => void;
    let finish!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.beforeDiskWrite = async () => {
      entered();
      await pending;
    };

    const nativeClose = new f.popup.Event("DOMWindowClose", {
      cancelable: true,
    });
    assert.equal(f.popup.dispatchEvent(nativeClose), false);
    assert.equal(nativeClose.defaultPrevented, true);
    const closing = session.closePromise!;
    assert.ok(closing);
    const repeatedClose = new f.popup.Event("DOMWindowClose", {
      cancelable: true,
    });
    assert.equal(f.popup.dispatchEvent(repeatedClose), false);
    assert.equal(session.closePromise, closing);
    await writing;
    assert.equal(root.inert, true);
    assert.equal(f.popup.closed, false);
    assert.equal(whiteboardRegistry.findByItem(f.item.id), session);
    assert.equal(documentWorkspace(f.item.id)?.open, true);
    assert.equal(session.saveCoordinator!.dirty, true);
    assert.equal(session.saveCoordinator!.writing, true);
    assert.equal(f.disk, originalDisk);
    assert.equal(f.diskWrites, 0);
    assert.deepEqual(f.notifications, []);

    finish();
    assert.equal(await closing, true);
    assert.deepEqual(parseStoredCanvas(f.disk).document.nodes, draft.nodes);
    assert.equal(f.diskWrites, 1);
    assert.equal(session.fileRevision!.content, f.disk);
    assert.equal(session.saveCoordinator!.dirty, false);
    assert.ok(
      f.frames[0].messages.some(
        (message) =>
          message.type === "saveState" && message.payload.state === "saved",
      ),
    );
    assert.equal(root.isConnected, false);
    assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
    assert.equal(f.popup.closed, true);
    assert.equal(
      f.nativeWindowCloses,
      1,
      "host close does not reenter native-close handling",
    );
    assert.equal(documentWorkspace(f.item.id)?.open, false);
    assert.deepEqual(f.notifications, [["refresh", "itempane", [], {}]]);
  },
);

test(
  "an asynchronously loaded chrome window binds native-close listeners after its initial blank inner window is replaced",
  { timeout: 2000 },
  async (t) => {
    const f = setupTransfer(t, false);
    const blankDocument = f.popup.document;
    blankDocument.getElementById("bamboo-whiteboard-window-root")!.remove();
    const initialListeners: Parameters<typeof f.popup.addEventListener>[] = [];
    const addListener = f.popup.addEventListener.bind(f.popup);
    const removeListener = f.popup.removeEventListener.bind(f.popup);
    const dispatch = f.popup.dispatchEvent.bind(f.popup);
    let awaitingLoad!: () => void;
    const waitingForChrome = new Promise<void>((resolve) => {
      awaitingLoad = resolve;
    });
    t.mock.method(
      f.popup,
      "addEventListener",
      (...args: Parameters<typeof f.popup.addEventListener>) => {
        if (
          f.popup.document === blankDocument &&
          ["close", "DOMWindowClose", "unload"].includes(args[0])
        ) {
          initialListeners.push(args);
        }
        addListener(...args);
        if (args[0] === "load") awaitingLoad();
      },
    );
    t.mock.method(
      f.popup,
      "dispatchEvent",
      (event: Parameters<typeof f.popup.dispatchEvent>[0]) => {
        // Happy DOM's own about:blank load is unrelated to the native chrome page.
        if (event.type === "load" && f.popup.document === blankDocument)
          return true;
        return dispatch(event);
      },
    );
    let staleCloseCalls = 0;
    f.popup.addEventListener(
      "DOMWindowClose",
      () => {
        staleCloseCalls += 1;
      },
      true,
    );

    const opening = openWhiteboardWindow(f.item);
    await waitingForChrome;
    assert.equal(whiteboardRegistry.findByItem(f.item.id), f.oldSession);
    assert.equal(f.oldSession.view!.root.inert, true);
    assert.equal(f.frames.length, 0);
    // Navigation keeps the outer window identity but drops old inner-window listeners.
    for (const listener of initialListeners) removeListener(...listener);
    const chromeDocument = blankDocument.implementation.createHTMLDocument();
    Object.defineProperty(chromeDocument, "defaultView", { value: f.popup });
    Object.defineProperty(f.popup, "document", {
      configurable: true,
      writable: true,
      value: chromeDocument,
    });
    const chromeRoot = chromeDocument.createElement("div");
    chromeRoot.id = "bamboo-whiteboard-window-root";
    chromeDocument.body.append(chromeRoot);
    installTransferFrame(t, f.popup, f.frames, () => {});
    f.popup.dispatchEvent(new f.popup.Event("load"));
    await opening;
    const session = whiteboardRegistry.findByItem(f.item.id)!;
    assert.notEqual(session, f.oldSession);
    assert.equal(session.view!.root.ownerDocument, chromeDocument);
    assert.equal(session.view!.root.isConnected, true);
    assert.equal(session.transitioning, false);

    const finalDraft = transferDocument("loaded chrome final draft", 6);
    f.frames[0].snapshot = finalDraft;
    f.frames[0].rev = 1;
    const nativeClose = new f.popup.Event("DOMWindowClose", {
      cancelable: true,
    });
    assert.equal(f.popup.dispatchEvent(nativeClose), false);
    assert.equal(nativeClose.defaultPrevented, true);
    assert.ok(session.closePromise);
    assert.equal(await session.closePromise, true);
    assert.deepEqual(
      parseStoredCanvas(f.disk).document.nodes,
      finalDraft.nodes,
    );
    assert.equal(f.diskWrites, 1);
    assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
    assert.equal(session.view!.root.isConnected, false);
    assert.equal(f.popup.closed, true);
    assert.equal(f.nativeWindowCloses, 1);
    assert.equal(
      staleCloseCalls,
      0,
      "the initial blank-window listener did not survive navigation",
    );
    assert.deepEqual(f.notifications, [["refresh", "itempane", [], {}]]);
  },
);

for (const failure of ["conflict", "disk full"] as const) {
  test(`DOMWindowClose preserves a usable unsaved window after ${failure} and never discards the draft`, async (t) => {
    const f = setupTransfer(t, failure === "conflict");
    await openWhiteboardWindow(f.item);
    const session = whiteboardRegistry.findByItem(f.item.id)!;
    const originalDisk = f.disk;
    const draft = transferDocument("unsaved closing draft", 6);
    f.frames[0].snapshot = draft;
    f.frames[0].rev = 1;
    if (failure === "disk full") {
      f.beforeDiskWrite = async () => {
        throw new Error("Disk full");
      };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const event = new f.popup.Event("DOMWindowClose", { cancelable: true });
      assert.equal(f.popup.dispatchEvent(event), false);
      assert.equal(event.defaultPrevented, true);
      const closing = session.closePromise;
      assert.ok(closing);
      assert.equal(await closing, false);
      assert.equal(whiteboardRegistry.findByItem(f.item.id), session);
      assert.equal(f.popup.closed, false);
      assert.equal(session.view!.root.isConnected, true);
      assert.equal(session.view!.root.inert, false);
      assert.equal(session.closing, undefined);
      assert.equal(session.closePromise, undefined);
      assert.equal(session.saveCoordinator!.dirty, true);
      assert.equal(documentWorkspace(f.item.id)?.open, true);
      assert.deepEqual(
        (await session.editor!.requestSnapshot()).snapshot,
        draft,
      );
      assert.equal(f.disk, originalDisk);
      assert.equal(f.diskWrites, 0);
      assert.deepEqual(f.notifications, []);
    }
    if (failure === "conflict") {
      assert.ok(
        session.saveCoordinator!.lastError instanceof FileConflictError,
      );
    } else {
      assert.equal(session.saveCoordinator!.lastError?.message, "Disk full");
    }
  });
}

for (const target of ["Window", "Document"] as const) {
  test(`only top-level ${target} unload clears a native window session and refreshes its sidebar`, async (t) => {
    const f = setupTransfer(t, false);
    await openWhiteboardWindow(f.item);
    const session = whiteboardRegistry.findByItem(f.item.id)!;
    const root = session.view!.root;
    const frame = root.querySelector("iframe")!;
    assert.ok(frame);
    const originalDisk = f.disk;
    frame.dispatchEvent(new f.popup.Event("unload"));
    assert.equal(whiteboardRegistry.findByItem(f.item.id), session);
    assert.equal(root.isConnected, true);
    assert.equal(documentWorkspace(f.item.id)?.open, true);
    assert.deepEqual(f.notifications, []);

    const topLevel = target === "Window" ? f.popup : f.popup.document;
    // Native unload does not bubble; Document targets require capture listening.
    topLevel.dispatchEvent(new f.popup.Event("unload"));
    assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
    assert.equal(session.closing, true);
    assert.equal(root.isConnected, false);
    assert.equal(documentWorkspace(f.item.id)?.open, false);
    assert.equal(f.diskWrites, 0);
    assert.equal(f.disk, originalDisk);
    assert.deepEqual(f.notifications, [["refresh", "itempane", [], {}]]);
    // A late unload from the disposed surface must not notify a second time.
    topLevel.dispatchEvent(new f.popup.Event("unload"));
    assert.deepEqual(f.notifications, [["refresh", "itempane", [], {}]]);
  });
}

async function mountNativeTab(t: TestContext) {
  const f = setupTransfer(t, false);
  // Start with no source editor so the tab's bridge and save coordinator are real.
  whiteboardRegistry.unregister(f.oldSession.tabID);
  f.oldSession.editor!.destroy();
  f.oldSession.view!.root.remove();
  installTransferFrame(t, f.main, f.frames, () => {});
  await openWhiteboardTab(f.item);
  return { f, session: whiteboardRegistry.findByItem(f.item.id)! };
}

test("a canceled Canvas opener queued behind an item lock does not focus the old surface", async (t) => {
  const { item, calls, session } = setup(t);
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const previous = whiteboardRegistry.withItemLock(item.id, () => blocked);
  let allowed = true;
  const opening = openWhiteboardTab(item, { shouldOpen: () => allowed });
  allowed = false;
  finish();
  await previous;
  assert.equal(await opening, null);
  assert.deepEqual(calls, []);
  assert.equal(whiteboardRegistry.findByItem(item.id), session);
});

test("Canvas opening canceled during a disk read never creates or registers a replacement tab", async (t) => {
  const f = setupTransfer(t, false);
  whiteboardRegistry.unregister(f.oldSession.tabID);
  f.oldSession.editor!.destroy();
  f.oldSession.view!.root.remove();
  let allowed = true;
  let started!: () => void;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const readFinished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const files = Zotero.File as unknown as {
    getContentsAsync(path: string): Promise<string>;
  };
  const originalRead = files.getContentsAsync.bind(files);
  t.mock.method(files, "getContentsAsync", async (path: string) => {
    if (path === "/tmp/transfer.canvas") {
      started();
      await readFinished;
    }
    return originalRead(path);
  });
  const opening = openWhiteboardTab(f.item, { shouldOpen: () => allowed });
  await waiting;
  allowed = false;
  finish();
  assert.equal(await opening, null);
  assert.equal(f.frames.length, 0);
  assert.deepEqual(f.nativeTabCloses, []);
  assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
});

test("Canvas opening canceled while its real iframe loads closes the provisional tab before registration", async (t) => {
  const f = setupTransfer(t, false);
  whiteboardRegistry.unregister(f.oldSession.tabID);
  f.oldSession.editor!.destroy();
  f.oldSession.view!.root.remove();
  let allowed = true;
  installTransferFrame(t, f.main, f.frames, () => {
    allowed = false;
  });
  assert.equal(
    await openWhiteboardTab(f.item, { shouldOpen: () => allowed }),
    null,
  );
  assert.equal(f.frames.length, 1);
  assert.equal(f.nativeTabCloses.length, 1);
  assert.equal(f.tabs._getTab(f.nativeTabCloses[0]).tab, undefined);
  assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
});

test(
  "closeAllWhiteboards retains a tab after failed saving and closes its native host only after a successful retry",
  { timeout: 2000 },
  async (t) => {
    const { f, session } = await mountNativeTab(t);
    const root = session.view!.root;
    const originalDisk = f.disk;
    const draft = transferDocument("tab closing draft", 6);
    f.frames[0].snapshot = draft;
    f.frames[0].rev = 1;
    session.saveCoordinator!.markChanged(1);
    Object.assign(f.main, { confirm: () => true });
    f.beforeDiskWrite = async () => {
      throw new Error("Disk full");
    };
    await closeAllWhiteboards();
    assert.equal(whiteboardRegistry.findByItem(f.item.id), session);
    assert.equal(root.isConnected, true);
    assert.equal(root.inert, false);
    assert.equal(session.saveCoordinator!.dirty, true);
    assert.deepEqual((await session.editor!.requestSnapshot()).snapshot, draft);
    assert.deepEqual(f.nativeTabCloses, []);
    assert.equal(f.disk, originalDisk);
    assert.equal(f.diskWrites, 0);

    let entered!: () => void;
    let finish!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.beforeDiskWrite = async () => {
      entered();
      await pending;
    };
    const closing = closeAllWhiteboards();
    await writing;
    assert.equal(whiteboardRegistry.findByItem(f.item.id), session);
    assert.equal(root.inert, true);
    assert.deepEqual(f.nativeTabCloses, []);
    assert.equal(f.disk, originalDisk);
    finish();
    await closing;
    assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
    assert.equal(root.isConnected, false);
    assert.deepEqual(parseStoredCanvas(f.disk).document.nodes, draft.nodes);
    assert.equal(f.diskWrites, 1);
    assert.deepEqual(f.nativeTabCloses, [session.tabID]);
    await closeAllWhiteboards();
    assert.deepEqual(f.nativeTabCloses, [session.tabID]);
  },
);

test("the native tab onClose callback disposes the editor without closing the tab host again", async (t) => {
  const { f, session } = await mountNativeTab(t);
  f.tabs.close(session.tabID);
  assert.ok(session.closePromise);
  assert.equal(await session.closePromise, true);
  assert.equal(whiteboardRegistry.findByItem(f.item.id), undefined);
  assert.equal(session.view!.root.isConnected, false);
  assert.deepEqual(f.nativeTabCloses, [session.tabID]);
});
