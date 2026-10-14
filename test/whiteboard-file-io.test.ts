import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureCanvasExtension,
  pickCanvasFile,
  readCanvasFile,
  writeCanvasFile,
} from "../src/modules/whiteboard/file-io.ts";
import { emptyCanvasDocument } from "../src/modules/whiteboard/snapshot.ts";

function installAttachmentGlobals(
  t: test.TestContext,
  importFromFile: (options: Record<string, unknown>) => Promise<unknown>,
) {
  const names = [
    "Zotero",
    "PathUtils",
    "IOUtils",
    "ztoolkit",
    "addon",
  ] as const;
  const previous = new Map(
    names.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
  );
  const selected: number[] = [];
  const directories: string[] = [];
  const removed: unknown[][] = [];
  let progressWindows = 0;
  Object.assign(globalThis, {
    Zotero: {
      Attachments: { importFromFile },
      File: {
        getValidFileName: (value: string) => value,
        putContentsAsync: async () => {},
      },
      Libraries: {
        userLibraryID: 101,
        get: (id: number) =>
          [101, 202, 505].includes(id) ? { libraryID: id } : false,
      },
      Collections: {
        get: (id: number) => (id === 303 ? { id, libraryID: 202 } : false),
      },
      getActiveZoteroPane: () => ({
        getSelectedCollections: () => [303],
        getSelectedLibraryIDs: () => [202],
        selectItem: async (itemID: number) => selected.push(itemID),
      }),
      getTempDirectory: () => ({ path: "/tmp" }),
    },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    IOUtils: {
      makeDirectory: async (path: string) => {
        directories.push(path);
      },
      exists: async () => false,
      remove: async (...args: unknown[]) => {
        removed.push(args);
      },
    },
    ztoolkit: {
      log: () => {},
      ProgressWindow: class {
        constructor() {
          progressWindows += 1;
        }
        createLine() {
          return this;
        }
        show() {
          return this;
        }
      },
    },
    addon: { data: { config: { addonName: "Bamboo" } } },
  });
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined)
        delete (globalThis as Record<string, unknown>)[name];
      else (globalThis as Record<string, unknown>)[name] = value;
    }
  });
  return {
    selected,
    directories,
    removed,
    progressWindows: () => progressWindows,
  };
}

test("only the canonical canvas suffix is accepted", () => {
  assert.equal(ensureCanvasExtension("review"), "review.canvas");
  assert.equal(ensureCanvasExtension("review.canvas"), "review.canvas");
  assert.equal(ensureCanvasExtension("review.CANVAS"), "review.CANVAS");
  assert.equal(ensureCanvasExtension("review.txt"), "review.txt.canvas");
});

test("the file picker advertises only Research Canvas files", async (t) => {
  const previous = (globalThis as { ztoolkit?: unknown }).ztoolkit;
  let constructorArguments: unknown[] = [];
  class FilePicker {
    constructor(...args: unknown[]) {
      constructorArguments = args;
    }

    async open() {
      return "/tmp/review.canvas";
    }
  }
  (globalThis as { ztoolkit?: unknown }).ztoolkit = { FilePicker };
  t.after(() => {
    (globalThis as { ztoolkit?: unknown }).ztoolkit = previous;
  });

  assert.equal(await pickCanvasFile("open"), "/tmp/review.canvas");
  assert.deepEqual(constructorArguments[2], [
    ["Research Canvas (*.canvas)", "*.canvas"],
  ]);
});

test("reads a schema-v2 canvas with recoverable diagnostics", async () => {
  const result = await readCanvasFile("/tmp/review.canvas", {
    readUTF8: async () =>
      JSON.stringify({
        version: 1,
        nodes: [
          {
            id: "note-1",
            type: "text",
            x: 0,
            y: 0,
            width: 260,
            height: 128,
            text: "Claim",
            bamboo: {
              node: { kind: "note", content: "Claim", badge: "Claim" },
            },
          },
          {
            id: "bad",
            type: "text",
            x: "not-a-number",
            y: 0,
            width: 100,
            height: 80,
            text: "Bad",
          },
        ],
        edges: [],
        bamboo: {
          schemaVersion: 2,
          createdAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z",
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
  });

  assert.equal(result.document.version, 2);
  assert.equal(result.document.nodes.length, 1);
  assert.deepEqual(
    result.issues.map(({ code, id }) => ({ code, id })),
    [{ code: "malformed-node", id: "bad" }],
  );
});

test("does not open legacy board suffixes through the canvas reader", async () => {
  let read = false;
  await assert.rejects(
    () =>
      readCanvasFile("/tmp/review.board", {
        readUTF8: async () => {
          read = true;
          return JSON.stringify({ version: 1, nodes: [], edges: [] });
        },
      }),
    /Canvas files must use the \.canvas extension/,
  );
  assert.equal(read, false);
});

test("rejects schema-v1 Bamboo and legacy xyflow files", async () => {
  await assert.rejects(
    () =>
      readCanvasFile("/tmp/schema-v1.canvas", {
        readUTF8: async () =>
          JSON.stringify({
            version: 1,
            nodes: [],
            edges: [],
            bamboo: { schemaVersion: 1 },
          }),
      }),
    /Bamboo schema version must be 2/,
  );
  await assert.rejects(
    () =>
      readCanvasFile("/tmp/legacy.canvas", {
        readUTF8: async () =>
          JSON.stringify({ v: 1, engine: "xyflow", nodes: [], edges: [] }),
      }),
    /Legacy xyflow canvas files are unsupported/,
  );
});

test("writes through a same-directory atomic temporary file", async () => {
  const calls: unknown[][] = [];
  const target = await writeCanvasFile(
    "/tmp/review.canvas",
    emptyCanvasDocument(),
    {
      writeUTF8: async (...args) => {
        calls.push(args);
        return 1;
      },
    },
  );
  assert.equal(target, "/tmp/review.canvas");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/tmp/review.canvas");
  assert.match(String(calls[0][1]), /"schemaVersion": 2/);
  assert.deepEqual(calls[0][2], {
    tmpPath: "/tmp/.review.canvas.tmp",
    flush: true,
  });
});

test("explicit attachment options override the active library and collection", async (t) => {
  let imported: Record<string, unknown> | undefined;
  const attachment = { id: 404, attachmentContentType: "application/json" };
  const globals = installAttachmentGlobals(t, async (options) => {
    imported = options;
    return attachment;
  });
  const { createWhiteboardAttachment } =
    await import("../src/modules/whiteboard/create.ts");

  const result = await createWhiteboardAttachment(null, {
    document: emptyCanvasDocument(),
    libraryID: 505,
    collections: [],
    filename: "Bamboo Tutorial.canvas",
    select: false,
    reportError: false,
  });

  assert.equal(result, attachment);
  assert.equal(imported?.libraryID, 505);
  assert.deepEqual(imported?.collections, []);
  assert.equal(imported?.title, "Bamboo Tutorial.canvas");
  assert.equal(imported?.fileBaseName, "Bamboo Tutorial");
  assert.equal(
    imported?.file,
    `${globals.directories[0]}/Bamboo Tutorial.canvas`,
  );
  assert.deepEqual(globals.removed, [
    [globals.directories[0], { recursive: true }],
  ]);
  assert.deepEqual(globals.selected, []);
});

test("omitted attachment options retain active-menu defaults", async (t) => {
  let imported: Record<string, unknown> | undefined;
  const attachment = { id: 404, attachmentContentType: "application/json" };
  const globals = installAttachmentGlobals(t, async (options) => {
    imported = options;
    return attachment;
  });
  const { createWhiteboardAttachment } =
    await import("../src/modules/whiteboard/create.ts");

  await createWhiteboardAttachment();

  assert.equal(imported?.libraryID, 202);
  assert.deepEqual(imported?.collections, [303]);
  assert.match(String(imported?.title), /^Canvas-\d{8}-\d{6}\.canvas$/);
  assert.equal(
    imported?.fileBaseName,
    String(imported?.title).replace(/\.canvas$/i, ""),
  );
  assert.deepEqual(globals.selected, [404]);
  assert.equal(imported?.file, `${globals.directories[0]}/${imported?.title}`);
  assert.deepEqual(globals.removed, [
    [globals.directories[0], { recursive: true }],
  ]);
});

test("reportError false suppresses the creation failure window", async (t) => {
  const globals = installAttachmentGlobals(t, async () => {
    throw new Error("import failed");
  });
  const { createWhiteboardAttachment } =
    await import("../src/modules/whiteboard/create.ts");

  assert.equal(
    await createWhiteboardAttachment(null, { reportError: false }),
    null,
  );
  assert.equal(globals.progressWindows(), 0);
});
