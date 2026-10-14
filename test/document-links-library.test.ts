import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  getNoteBacklinks,
  invalidateNoteLibrary,
  readLibraryNotes,
  updateIndexedNote,
  clearNoteLibraries,
} from "../src/modules/markdown/note-library.ts";
import {
  openDocumentLink,
  searchDocumentLinks,
} from "../src/modules/markdown/document-links.ts";
import { documentSyncRegistry } from "../src/modules/markdown/document-sync.ts";
import { sessionRegistry } from "../src/modules/markdown/session-registry.ts";

function installNotes(t: { after: (callback: () => void) => void }) {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  const files = new Map<string, string>([
    ["/notes/one.md", "# One\n\n[[Two--NOTE0002.md#Details]]"],
    ["/notes/two.md", "# Two\n\n## Details\nBody"],
  ]);
  const items = [
    makeItem(1, "NOTE0001", "zmd-One.md", "One.md", "/notes/one.md"),
    makeItem(2, "NOTE0002", "zmd-Two.md", "Two.md", "/notes/two.md"),
  ];
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: { userLibraryID: 1, get: () => undefined },
    Search: class {
      addCondition() {}
      async search() {
        return items.map((item) => item.id);
      }
    },
    Items: {
      get: (id: number) => items.find((item) => item.id === id),
      getAsync: async (ids: number[]) =>
        items.filter((item) => ids.includes(item.id)),
      getByLibraryAndKey: (libraryID: number, key: string) =>
        items.find((item) => item.libraryID === libraryID && item.key === key),
    },
    File: { getContentsAsync: async (path: string) => files.get(path) },
  };
  t.after(() => {
    clearNoteLibraries();
    globals.Zotero = previous;
  });
  return { items, files };
}

function makeItem(
  id: number,
  key: string,
  attachmentFilename: string,
  title: string,
  path: string,
): any {
  return {
    id,
    key,
    libraryID: 1,
    attachmentFilename,
    attachmentContentType: "text/markdown",
    attachmentLinkMode: 0,
    isAttachment: () => true,
    isRegularItem: () => false,
    isTrashed: () => false,
    getField: () => title,
    getDisplayTitle: () => title,
    getFilePathAsync: async () => path,
  };
}

test("loads note files, keeps saves in the index, and reports backlinks", async (t) => {
  const { items } = installNotes(t);
  const notes = await readLibraryNotes(1, { refresh: true });
  assert.equal(notes.length, 2);
  assert.equal(notes[0].content.startsWith("# One"), true);
  const links = await getNoteBacklinks(items[1]);
  assert.equal(links.unreadable, 0);
  assert.equal(links.entries.length, 1);
  assert.equal(links.entries[0].key, "NOTE0001");
  assert.equal(links.entries[0].position, notes[0].content.indexOf("[[Two"));

  updateIndexedNote(items[1], "# Changed");
  assert.equal((await readLibraryNotes(1))[1].content, "# Changed");
});

test("search returns a portable filename and heading when indexed content matches", async (t) => {
  const { items } = installNotes(t);
  const result = await searchDocumentLinks(items[0], "Two#Details");
  assert.equal(result[0]?.filename, "zmd-Two.md");
  assert.match(result[0]?.href || "", /Two--NOTE0002\.md#Details/);
  assert.equal(result[0]?.heading, "Details");
});

test("a read failure is visible and is not a successful empty note", async (t) => {
  const { items, files } = installNotes(t);
  files.delete("/notes/two.md");
  const notes = await readLibraryNotes(1, { refresh: true });
  const failed = notes.find((note) => note.key === "NOTE0002");
  assert.ok(failed?.readError);
  assert.equal((await getNoteBacklinks(items[0])).unreadable, 1);
});

test("native getAll children of a trashed parent do not produce backlinks or unreadable warnings", async (t) => {
  const { items, files } = installNotes(t);
  const api = (globalThis as any).Zotero;
  const parent = { id: 10, libraryID: 1, deleted: true };
  items[0].parentItemID = parent.id;
  api.Items.getAll = async () => items;
  api.Items.get = (id: number) =>
    id === parent.id ? parent : items.find((item) => item.id === id);
  let sourceReads = 0;
  items[0].getFilePathAsync = async () => {
    sourceReads++;
    return false;
  };
  const excluded = await getNoteBacklinks(items[1]);
  assert.deepEqual(excluded, { entries: [], unreadable: 0, failures: [] });
  assert.equal(sourceReads, 0, "the trashed parent's child must not be opened");

  parent.deleted = false;
  invalidateNoteLibrary(1);
  const unavailable = await getNoteBacklinks(items[1]);
  assert.equal(unavailable.unreadable, 1);
  assert.equal(unavailable.failures[0].key, "NOTE0001");
  assert.equal(unavailable.failures[0].reason, "unavailable");
  items[0].getFilePathAsync = async () => "/notes/one.md";
  invalidateNoteLibrary(1);
  assert.equal((await getNoteBacklinks(items[1])).entries.length, 1);
  parent.deleted = true;
  invalidateNoteLibrary(1);
  assert.deepEqual(await getNoteBacklinks(items[1]), {
    entries: [],
    unreadable: 0,
    failures: [],
  });
  assert.ok(files.get("/notes/one.md"), "trashing did not change source files");
});

test("backlink failures distinguish pending downloads and read exceptions without exposing paths or counting self", async (t) => {
  const { items, files } = installNotes(t);
  const api = (globalThis as any).Zotero;
  files.set("/notes/one.md", "# No outgoing link");
  const pending = makeItem(3, "DOWNLOAD", "Waiting.md", "Waiting", "unused");
  Object.assign(pending, {
    attachmentSyncState: 1,
    isStoredFileAttachment: () => true,
    getFilePath: () =>
      "C:\\Users\\Private\\Zotero\\storage\\DOWNLOAD\\Waiting.md",
    getFilePathAsync: async () => false,
  });
  const unavailable = makeItem(
    4,
    "MISSING1",
    "Missing.md",
    "Missing",
    "unused",
  );
  Object.assign(unavailable, {
    isStoredFileAttachment: () => false,
    getFilePathAsync: async () => false,
  });
  const denied = makeItem(5, "DENIED01", "Denied.md", "Denied", "/denied.md");
  items.push(pending, unavailable, denied);
  const read = api.File.getContentsAsync;
  api.File.getContentsAsync = async (path: string) => {
    if (path === "/denied.md")
      throw new Error("Permission denied: C:\\Users\\Private\\Denied.md");
    return read(path);
  };
  items[1].getFilePathAsync = async () => false;
  const result = await getNoteBacklinks(items[1]);
  assert.equal(result.entries.length, 0);
  assert.equal(result.unreadable, 3);
  assert.deepEqual(result.failures, [
    {
      key: "DOWNLOAD",
      title: "Waiting",
      reason: "not-downloaded",
      stage: "path",
    },
    { key: "MISSING1", title: "Missing", reason: "unavailable", stage: "path" },
    { key: "DENIED01", title: "Denied", reason: "read-error", stage: "read" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result.failures),
    /Private|Users|Permission denied/,
  );

  pending.attachmentSyncState = 4;
  invalidateNoteLibrary(1);
  assert.equal(
    (await getNoteBacklinks(items[1])).failures[0].reason,
    "not-downloaded",
  );
  pending.attachmentSyncState = 2;
  invalidateNoteLibrary(1);
  assert.equal(
    (await getNoteBacklinks(items[1])).failures[0].reason,
    "unavailable",
  );
});

test("an invalidated scan follows the new cache and preserves a scanned path", async (t) => {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  const item = makeItem(1, "NOTE0001", "zmd-Note.md", "Note.md", "/note.md");
  let reads = 0;
  let releaseFirst!: () => void;
  let started!: () => void;
  const firstRead = new Promise<void>((resolve) => (releaseFirst = resolve));
  const scanStarted = new Promise<void>((resolve) => (started = resolve));
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: { userLibraryID: 1, get: () => undefined },
    Items: { getAll: async () => [item] },
    File: {
      getContentsAsync: async () => {
        reads += 1;
        if (reads === 1) {
          started();
          await firstRead;
          return "# Old";
        }
        return "# Fresh";
      },
    },
  };
  t.after(() => {
    clearNoteLibraries();
    globals.Zotero = previous;
  });

  const original = readLibraryNotes(1, { refresh: true });
  await scanStarted;
  invalidateNoteLibrary(1);
  const newest = readLibraryNotes(1);
  releaseFirst();
  const [oldResult, newResult] = await Promise.all([original, newest]);
  assert.equal(oldResult[0]?.content, "# Fresh");
  assert.equal(newResult[0]?.content, "# Fresh");
  assert.equal(newResult[0]?.path, "/note.md");

  clearNoteLibraries();
  reads = 0;
  let releaseSaveRead!: () => void;
  let saveReadStarted!: () => void;
  const saveRead = new Promise<void>((resolve) => (releaseSaveRead = resolve));
  const saveStarted = new Promise<void>(
    (resolve) => (saveReadStarted = resolve),
  );
  globals.Zotero.File.getContentsAsync = async () => {
    saveReadStarted();
    await saveRead;
    return "# Old";
  };
  const savingScan = readLibraryNotes(1, { refresh: true });
  await saveStarted;
  updateIndexedNote(item, "# Saved");
  releaseSaveRead();
  const saved = await savingScan;
  assert.equal(saved[0]?.content, "# Saved");
  assert.equal(saved[0]?.path, "/note.md");
});

test("metadata completion keeps a portable Markdown href when body indexing fails", async (t) => {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  const item = makeItem(
    1,
    "NOTE0001",
    "zmd-Portable.md",
    "Portable.md",
    "/portable.md",
  );
  let searches = 0;
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: { userLibraryID: 1, get: () => undefined },
    Search: class {
      addCondition() {}
      async search() {
        searches += 1;
        if (searches > 1) throw new Error("body index unavailable");
        return [item.id];
      }
    },
    Items: { getAsync: async () => [item] },
  };
  t.after(() => {
    clearNoteLibraries();
    globals.Zotero = previous;
  });

  const result = await searchDocumentLinks(item, "Portable");
  assert.equal(result[0]?.filename, "zmd-Portable.md");
  assert.match(result[0]?.href || "", /Portable--NOTE0001\.md$/);
});

test("navigation waits for an existing tab's document refresh before locating a heading", async (t) => {
  const globals = globalThis as any;
  const previous = {
    Zotero: globals.Zotero,
    addon: globals.addon,
    ztoolkit: globals.ztoolkit,
  };
  const main = new Window() as any;
  const source = makeItem(
    1,
    "NOTE0001",
    "zmd-Source.md",
    "Source.md",
    "/source.md",
  );
  const target = makeItem(
    2,
    "NOTE0002",
    "zmd-Target.md",
    "Target.md",
    "/target.md",
  );
  let value = "# Old";
  let revealed: number | undefined;
  let releasePersisted!: (value: string) => void;
  const persisted = new Promise<string>(
    (resolve) => (releasePersisted = resolve),
  );
  const session = {
    tabID: "target-tab",
    surface: "tab" as const,
    sourceID: "tab:target-tab",
    documentSyncSourceID: "target-source",
    itemID: target.id,
    path: "/target.md",
    mode: "live" as const,
    win: main,
    isActive: () => true,
    updateTitle: () => {},
    save: {} as any,
    editor: {
      getValue: () => value,
      revealPosition: (position: number) => (revealed = position),
      focus: () => {},
    },
  } as any;
  sessionRegistry.register(session);
  const unregisterTarget = documentSyncRegistry.register({
    sourceID: "target-source",
    itemID: target.id,
    hasLocalWork: () => false,
    flush: async () => {},
    getCurrentValue: () => value,
    readPersisted: () => persisted,
    applyPersisted: (next: string) => {
      value = next;
    },
  });
  const unregisterPeer = documentSyncRegistry.register({
    sourceID: "peer-source",
    itemID: target.id,
    hasLocalWork: () => false,
    flush: async () => {},
    getCurrentValue: () => "",
    readPersisted: async () => "",
    applyPersisted: () => {},
  });
  documentSyncRegistry.markSaved("peer-source");
  main.Zotero_Tabs = {
    add: () => {
      throw new Error("not creating");
    },
    _getTab: () => ({ tab: { title: "Target" } }),
    select: () => {},
  };
  globals.addon = { data: { config: { addonName: "Bamboo" } } };
  globals.ztoolkit = { getGlobal: () => undefined, log: () => {} };
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: { userLibraryID: 1, get: () => undefined },
    Items: {
      getAll: async () => [source, target],
      get: (id: number) => (id === target.id ? target : source),
      getByLibraryAndKey: (_libraryID: number, key: string) =>
        key === target.key ? target : key === source.key ? source : undefined,
    },
    File: { getContentsAsync: async () => "# Target\n\n## Details\n" },
    getMainWindow: () => main,
  };
  t.after(() => {
    unregisterPeer();
    unregisterTarget();
    sessionRegistry.unregister(session.tabID);
    clearNoteLibraries();
    main.close();
    globals.Zotero = previous.Zotero;
    globals.addon = previous.addon;
    globals.ztoolkit = previous.ztoolkit;
  });

  const navigation = openDocumentLink("[[Target--NOTE0002#Details]]", {
    currentItem: source,
    win: main,
  });
  for (
    let attempt = 0;
    attempt < 100 && !session.documentSyncRefresh;
    attempt++
  ) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.ok(session.documentSyncRefresh);
  releasePersisted("# Target\n\n## Details\n");
  const result = await navigation;
  assert.equal(result.status, "opened");
  assert.equal(value, "# Target\n\n## Details\n");
  assert.equal(revealed, 10);
});

test("item notifications and app return refresh cached backlinks", async (t) => {
  const { items, files } = installNotes(t);
  const { registerNoteLibraryObserver, bindNoteLibraryWindow } =
    await import("../src/modules/markdown/note-library.ts");
  let notify!: (event: string, type: string) => void;
  let registered = 0;
  let unregistered = 0;
  (globalThis as any).Zotero.Notifier = {
    registerObserver(observer: { notify: typeof notify }) {
      notify = observer.notify;
      registered++;
      return "note-observer";
    },
    unregisterObserver(id: string) {
      assert.equal(id, "note-observer");
      unregistered++;
    },
  };
  registerNoteLibraryObserver();
  registerNoteLibraryObserver();
  assert.equal(registered, 1);
  assert.equal((await getNoteBacklinks(items[1])).entries.length, 1);
  files.set("/notes/one.md", "# No link");
  notify("modify", "item");
  assert.equal((await getNoteBacklinks(items[1])).entries.length, 0);

  files.set("/notes/one.md", "[[Two]]");
  const win = new Window();
  const unbind = bindNoteLibraryWindow(win as any);
  const unbindPeer = bindNoteLibraryWindow(win as any);
  unbind();
  win.dispatchEvent(new win.Event("focus"));
  assert.equal((await getNoteBacklinks(items[1])).entries.length, 1);

  items[0].deleted = true;
  notify("trash", "item");
  assert.equal((await getNoteBacklinks(items[1])).entries.length, 0);
  items.splice(0, 1);
  notify("delete", "item");
  assert.deepEqual(
    (await readLibraryNotes(1)).map((note) => note.key),
    ["NOTE0002"],
  );
  unbindPeer();
  clearNoteLibraries();
  assert.equal(unregistered, 1);
  win.close();
});

test("sync completion retries only loaded failed libraries after an attachment download", async (t) => {
  const { items, files } = installNotes(t);
  const { registerNoteLibraryObserver } =
    await import("../src/modules/markdown/note-library.ts");
  const api = (globalThis as any).Zotero;
  const healthy = makeItem(
    20,
    "HEALTHY1",
    "Healthy.md",
    "Healthy",
    "/healthy.md",
  );
  healthy.libraryID = 2;
  api.Libraries.get = (id: number) =>
    id === 2 ? { libraryType: "group", groupID: 20 } : undefined;
  api.Items.getAll = async (libraryID: number) =>
    libraryID === 1 ? items : [healthy];
  files.set("/healthy.md", "# Healthy");
  let downloaded = false;
  items[0].getFilePathAsync = async () =>
    downloaded ? "/notes/one.md" : false;
  const reads = new Map<string, number>();
  const read = api.File.getContentsAsync;
  api.File.getContentsAsync = async (path: string) => {
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return read(path);
  };
  let observer!: {
    notify: (event: string, type: string, ids?: number[]) => void;
  };
  let unregistered = 0;
  api.Notifier = {
    registerObserver(value: typeof observer, types: string[]) {
      observer = value;
      assert.ok(types.includes("sync"));
      return "sync-note-library";
    },
    unregisterObserver(id: string) {
      assert.equal(id, "sync-note-library");
      unregistered++;
    },
  };
  registerNoteLibraryObserver();
  assert.equal((await getNoteBacklinks(items[1])).unreadable, 1);
  assert.equal((await getNoteBacklinks(healthy)).unreadable, 0);
  assert.equal(reads.get("/healthy.md"), 1);

  downloaded = true;
  observer.notify("start", "sync", [1, 2]);
  assert.equal((await getNoteBacklinks(items[1])).unreadable, 1);
  observer.notify("finish", "sync", [2]);
  assert.equal(
    (await getNoteBacklinks(items[1])).unreadable,
    1,
    "another library's sync does not retry this one",
  );
  observer.notify("finish", "sync", [1, 2]);
  const recovered = await getNoteBacklinks(items[1]);
  assert.equal(recovered.unreadable, 0);
  assert.deepEqual(recovered.failures, []);
  assert.equal(recovered.entries.length, 1);
  assert.equal(reads.get("/notes/one.md"), 1);
  await getNoteBacklinks(healthy);
  assert.equal(
    reads.get("/healthy.md"),
    1,
    "successful libraries retain their cache",
  );
  observer.notify("finish", "sync", []);
  await getNoteBacklinks(items[1]);
  assert.equal(
    reads.get("/notes/one.md"),
    1,
    "a fully indexed library is not scanned on every sync",
  );
  clearNoteLibraries();
  assert.equal(unregistered, 1);
});

test("notifications index new Markdown in the background, batch updates, and stop on disposal", async (t) => {
  const { items, files } = installNotes(t);
  const { registerNoteLibraryObserver } =
    await import("../src/modules/markdown/note-library.ts");
  let observer: any;
  let reads = 0;
  const api = (globalThis as any).Zotero;
  api.File.getContentsAsync = async (path: string) => {
    reads++;
    return files.get(path);
  };
  api.Notifier = {
    registerObserver(value: any) {
      observer = value;
      return "background-test";
    },
    unregisterObserver() {},
  };
  registerNoteLibraryObserver();
  const other = makeItem(3, "PDF00003", "paper.pdf", "Paper", "/paper.pdf");
  other.attachmentContentType = "application/pdf";
  items.push(other);
  observer.notify("add", "item", [3], {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(reads, 0, "non-Markdown additions do not start a scan");
  observer.notify("add", "item", [1], {});
  observer.notify("modify", "item", [1], {});
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    reads,
    2,
    "one background scan parses the two Markdown files without a UI request",
  );
  files.set("/notes/one.md", "[[Updated]]");
  observer.notify("modify", "file", [1], {});
  await new Promise((resolve) => setTimeout(resolve, 350));
  const afterBackground = reads;
  assert.equal(
    (await readLibraryNotes(1)).find((note) => note.key === "NOTE0001")
      ?.content,
    "[[Updated]]",
  );
  assert.equal(reads, afterBackground, "background scan populates the cache");
  items.splice(0, 1);
  observer.notify("delete", "item", [1], { 1: { libraryID: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.deepEqual(
    (await readLibraryNotes(1)).map((note) => note.key),
    ["NOTE0002"],
  );
  observer.notify("modify", "item", [2], {});
  clearNoteLibraries();
  const beforeDispose = reads;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(reads, beforeDispose, "disposal cancels queued work");
});
