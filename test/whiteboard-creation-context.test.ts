import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as paneCompatibility from "../src/compat/zotero-pane.ts";
import * as snapshot from "../src/modules/whiteboard/snapshot.ts";
import { serializeCanvasDocument } from "../packages/whiteboard/src/model/canvas-file.ts";

type Pane = Record<string, unknown>;
type WindowFixture = { ZoteroPane: Pane; closed?: boolean };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function fixture() {
  let pane: Pane = {};
  let makeDirectory = async () => {};
  const imports: Record<string, unknown>[] = [];
  const selected: number[] = [];
  const opened: Array<{ item: unknown; options: Record<string, unknown> }> = [];
  const remembered: number[] = [];
  const progress: string[] = [];
  const libraries = new Map([
    [1, { editable: true, filesEditable: true }],
    [202, { editable: true, filesEditable: true }],
    [204, { editable: true, filesEditable: true }],
  ]);
  const collections = new Map([
    [303, { id: 303, libraryID: 202, getChildItems: () => [], deleted: false }],
    [305, { id: 305, libraryID: 204, getChildItems: () => [], deleted: false }],
    [306, { id: 306, libraryID: 202, getChildItems: () => [], deleted: true }],
  ]);
  const attachment = { id: 404, attachmentContentType: "application/json" };
  const Zotero = {
    getActiveZoteroPane: () => pane,
    Libraries: { userLibraryID: 1, get: (id: number) => libraries.get(id) },
    Collections: { get: (id: number) => collections.get(id) },
    getTempDirectory: () => ({ path: "/temp" }),
    File: {
      getValidFileName: (value: string) => value,
      putContentsAsync: async () => {},
    },
    Attachments: {
      importFromFile: async (options: Record<string, unknown>) => {
        imports.push(structuredClone(options));
        return attachment;
      },
    },
  };
  const mocks: Record<string, unknown> = {
    "./snapshot": snapshot,
    "../../../packages/whiteboard/src/model/canvas-file": {
      serializeCanvasDocument,
    },
    "../../compat/zotero-pane": paneCompatibility,
    "./detect": { defaultCanvasFilename: () => "Canvas.canvas" },
    "./source-gateway": { createZoteroSourceGateway: () => ({}) },
    "./tab": {
      openWhiteboardTab: async (
        item: unknown,
        options: Record<string, unknown>,
      ) => {
        opened.push({ item, options });
        return "canvas-tab";
      },
    },
    "./open": { rememberWhiteboard: (id: number) => remembered.push(id) },
  };
  const module = { exports: {} as Record<string, unknown> };
  const { outputText } = transpileModule(
    readFileSync(
      new URL("../src/modules/whiteboard/create.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
      },
    },
  );
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected create dependency: ${name}`);
    },
    Zotero,
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    IOUtils: {
      makeDirectory: () => makeDirectory(),
      remove: async () => {},
    },
    addon: { data: { config: { addonName: "Scholar Sketch" } } },
    ztoolkit: {
      log: () => {},
      ProgressWindow: class {
        createLine({ text }: { text: string }) {
          progress.push(text);
          return this;
        }
        show() {}
      },
    },
  });
  const api = module.exports as {
    createWhiteboardAttachment(
      parent?: unknown,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    createWhiteboardFromCollection(options?: {
      win?: WindowFixture;
      shouldOpen?: () => boolean;
    }): Promise<void>;
  };
  const selectItem = async (id: number) => void selected.push(id);
  return {
    ...api,
    imports,
    selected,
    opened,
    remembered,
    progress,
    libraries,
    host: Zotero,
    setPane(value: Pane) {
      pane = { selectItem, ...value };
    },
    pane(value: Pane): Pane {
      return { selectItem, ...value };
    },
    setMakeDirectory(value: () => Promise<void>) {
      makeDirectory = value;
    },
  };
}

test("creation resolves singular and plural selections and rejects foreign or deleted collections", async () => {
  const f = fixture();
  for (const legacy of [false, true]) {
    f.setPane(
      legacy
        ? { getSelectedLibraryID: () => 202, getSelectedCollection: () => 303 }
        : {
            getSelectedLibraryIDs: () => [202, 204],
            getSelectedCollections: () => [305, 306, 303],
          },
    );
    await f.createWhiteboardAttachment(null, { reportError: false });
    assert.equal(f.imports.at(-1)?.libraryID, 202);
    assert.deepEqual(f.imports.at(-1)?.collections, [303]);
  }
  f.setPane({
    getSelectedLibraryIDs: () => [0, -1, 999],
    getSelectedCollections: () => [303],
  });
  await f.createWhiteboardAttachment(null, { reportError: false });
  assert.equal(f.imports.at(-1)?.libraryID, 1);
  assert.equal(f.imports.at(-1)?.collections, undefined);
});

test("creation captures its owning pane before asynchronous filesystem work", async () => {
  const f = fixture();
  const wait = deferred();
  f.setMakeDirectory(() => wait.promise);
  let libraryID = 202;
  let collectionID = 303;
  const win = {
    ZoteroPane: f.pane({
      getSelectedLibraryID: () => libraryID,
      getSelectedCollection: () => collectionID,
    }),
  };
  f.setPane({ getSelectedLibraryIDs: () => [1] });
  const creating = f.createWhiteboardAttachment(null, {
    win,
    reportError: false,
  });
  libraryID = 204;
  collectionID = 305;
  wait.resolve();
  await creating;
  assert.equal(f.imports[0].libraryID, 202);
  assert.deepEqual(f.imports[0].collections, [303]);
  assert.deepEqual(f.selected, [404]);
});

test("explicit creation targets filter collections without borrowing another library", async () => {
  const f = fixture();
  f.setPane({
    getSelectedLibraryIDs: () => [204],
    getSelectedCollections: () => [305],
  });
  await f.createWhiteboardAttachment(null, {
    libraryID: 202,
    collections: [305, 303, 306, 303, 0],
    reportError: false,
  });
  assert.equal(f.imports[0].libraryID, 202);
  assert.deepEqual(f.imports[0].collections, [303]);
  const result = await f.createWhiteboardAttachment(null, {
    libraryID: 999,
    reportError: false,
  });
  assert.equal(result, null);
  assert.equal(f.imports.length, 1);
});

test("missing host lookup APIs cannot authorize an unverified creation target", async () => {
  const f = fixture();
  f.setPane({
    getSelectedLibraryID: () => 202,
    getSelectedCollection: () => 303,
  });
  Reflect.deleteProperty(f.host.Collections, "get");
  await f.createWhiteboardAttachment(null, { reportError: false });
  assert.equal(f.imports[0].libraryID, 202);
  assert.equal(f.imports[0].collections, undefined);
  Reflect.deleteProperty(f.host.Libraries, "get");
  assert.equal(
    await f.createWhiteboardAttachment(null, { reportError: false }),
    null,
  );
  assert.equal(f.imports.length, 1);
});

test("annotation descendants use the regular parent without standalone collection membership", async () => {
  const f = fixture();
  const regular = { id: 80, libraryID: 202, isRegularItem: () => true };
  const pdf = { parentItem: regular, isRegularItem: () => false };
  const annotation = { parentItem: pdf, isRegularItem: () => false };
  await f.createWhiteboardAttachment(annotation, {
    libraryID: 204,
    collections: [305],
    reportError: false,
  });
  assert.equal(f.imports[0].parentItemID, 80);
  assert.equal(f.imports[0].libraryID, undefined);
  assert.equal(f.imports[0].collections, undefined);
});

test("collection generation uses the captured window and collection even when the active pane changes", async () => {
  const f = fixture();
  const wait = deferred();
  f.setMakeDirectory(() => wait.promise);
  const win = {
    ZoteroPane: f.pane({
      getSelectedLibraryID: () => 202,
      getSelectedCollection: () => 303,
    }),
  };
  f.setPane({
    getSelectedLibraryIDs: () => [204],
    getSelectedCollections: () => [305],
  });
  const creating = f.createWhiteboardFromCollection({ win });
  wait.resolve();
  await creating;
  assert.equal(f.imports[0].libraryID, 202);
  assert.deepEqual(f.imports[0].collections, [303]);
  assert.equal(f.opened[0].options.win, win);
  assert.deepEqual(f.remembered, [404]);
});

test("collection creation rejects readonly targets and canceled late opens", async () => {
  const f = fixture();
  const win = {
    ZoteroPane: f.pane({
      getSelectedLibraryIDs: () => [202],
      getSelectedCollections: () => [303],
    }),
  };
  f.libraries.get(202)!.filesEditable = false;
  await f.createWhiteboardFromCollection({ win });
  assert.equal(f.imports.length, 0);
  f.libraries.get(202)!.filesEditable = true;
  const wait = deferred();
  f.setMakeDirectory(() => wait.promise);
  let current = true;
  const creating = f.createWhiteboardFromCollection({
    win,
    shouldOpen: () => current,
  });
  current = false;
  wait.resolve();
  await creating;
  assert.equal(
    f.imports.length,
    1,
    "the attachment remains intact after creation",
  );
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.remembered, []);
});
