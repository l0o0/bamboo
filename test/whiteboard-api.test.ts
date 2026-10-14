import assert from "node:assert/strict";
import test from "node:test";
import { canvasApi } from "../src/modules/whiteboard/api.ts";
import { whiteboardRegistry } from "../src/modules/whiteboard/session-registry.ts";
import { openWhiteboardTab } from "../src/modules/whiteboard/tab.ts";

const file = (text: string) => ({
  nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 280, height: 180, text }],
  edges: [],
});

test("public canvas API validates, creates, reads and protects replacement writes", async (t) => {
  const globals = globalThis as Record<string, unknown>;
  const names = ["Zotero", "IOUtils", "PathUtils", "ztoolkit", "addon"];
  const previous = names.map((name) => globals[name]);
  const disk = new Map<string, string>([
    ["/board.canvas", JSON.stringify(file("Original"))],
  ]);
  let editable = true;
  let saves = 0;
  const board = {
    id: 1,
    key: "BOARD001",
    libraryID: 1,
    attachmentFilename: "board.canvas",
    attachmentLinkMode: 0,
    attachmentContentType: "application/json",
    attachmentSyncState: "",
    getField: () => "Board",
    isAttachment: () => true,
    getFilePathAsync: async () => "/board.canvas",
    saveTx: async () => {
      saves++;
    },
  };
  const paper = {
    id: 2,
    key: "PAPER001",
    libraryID: 1,
    itemType: "journalArticle",
    isRegularItem: () => true,
    isAttachment: () => false,
    isNote: () => false,
    isAnnotation: () => false,
    getField: (key: string) => (key === "title" ? "Paper" : ""),
    getAttachments: () => [],
    getTags: () => [],
  };
  const attachment = {
    ...paper,
    id: 3,
    key: "PDF00001",
    parentItem: paper,
    isRegularItem: () => false,
    isAttachment: () => true,
    attachmentFilename: "paper.pdf",
    attachmentContentType: "application/pdf",
  };
  const note = {
    ...paper,
    id: 4,
    key: "NOTE0001",
    parentItem: paper,
    isRegularItem: () => false,
    isNote: () => true,
    getNote: () => "<p>Note</p>",
    getNoteTitle: () => "Note",
  };
  const quote = {
    ...paper,
    id: 5,
    key: "QUOTE001",
    parentItem: attachment,
    isRegularItem: () => false,
    isAnnotation: () => true,
    annotationType: "highlight",
    annotationText: "Evidence",
    annotationPageLabel: "3",
  };
  const items = new Map<number, unknown>([
    [1, board],
    [2, paper],
    [3, attachment],
    [4, note],
    [5, quote],
  ]);
  Object.assign(globals, {
    Zotero: {
      Utilities: {
        cleanTags: (html: string) => html.replace(/<[^>]+>/g, ""),
        unescapeHTML: (text: string) => text,
      },
      Items: {
        get: (id: number) => items.get(id),
        getAll: async () => [board],
      },
      Libraries: {
        userLibraryID: 1,
        get: () => ({ editable, filesEditable: editable }),
      },
      Attachments: {
        LINK_MODE_IMPORTED_FILE: 0,
        LINK_MODE_LINKED_URL: 3,
        importFromFile: async (options: {
          file: string;
          collections?: number[];
          parentItemID?: number;
          libraryID?: number;
        }) => {
          if (options.parentItemID !== undefined) {
            assert.equal(options.parentItemID, paper.id);
            assert.equal(options.collections, undefined);
            assert.equal(options.libraryID, undefined);
          } else {
            assert.deepEqual(options.collections, []);
          }
          disk.set("/board.canvas", disk.get(options.file)!);
          return board;
        },
      },
      File: {
        getContentsAsync: async (path: string) => disk.get(path),
        getValidFileName: (name: string) => name,
        putContentsAsync: async (path: string, content: string) =>
          disk.set(path, content),
      },
      getActiveZoteroPane: () => ({ getSelectedItems: () => [paper] }),
      getTempDirectory: () => ({ path: "/tmp" }),
      DataDirectory: { dir: "/data" },
    },
    IOUtils: {
      writeUTF8: async (path: string, content: string) => {
        disk.set(path, content);
      },
      exists: async () => false,
      makeDirectory: async () => {},
      remove: async () => {},
    },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    ztoolkit: { log: () => {} },
    addon: {
      data: {
        locale: {
          current: { formatMessagesSync: () => [{ value: "Conflict" }] },
        },
      },
    },
  });
  try {
    assert.equal((await canvasApi.validate(file("Text"))).nodes.length, 1);
    await assert.rejects(canvasApi.validate({ nodes: [{ id: "bad" }] }), {
      code: "INVALID_ARGUMENT",
    });
    await assert.rejects(
      canvasApi.validate({
        ...file("Text"),
        edges: [{ id: "dangling", fromNode: "n", toNode: "missing" }],
      }),
      { code: "INVALID_ARGUMENT" },
    );
    assert.equal((await canvasApi.list()).length, 1);
    assert.equal((await canvasApi.getSelection())[0].itemID, 2);
    const sources = await canvasApi.fromItems([2, 2]);
    assert.equal(sources.nodes.length, 1);
    assert.equal(
      (sources.nodes[0].bamboo?.node?.source as { itemKey: string }).itemKey,
      "PAPER001",
    );
    const mixed = await canvasApi.validate(
      await canvasApi.fromItems([2, 3, 4, 5]),
    );
    assert.deepEqual(
      mixed.nodes.map((n) => n.bamboo?.node?.kind),
      ["literature", "attachment", "note", "quote"],
    );
    assert.equal(
      (
        mixed.nodes[1].bamboo?.node?.data as {
          source: { attachmentKey: string };
        }
      ).source.attachmentKey,
      "PDF00001",
    );
    await assert.rejects(canvasApi.fromItems([999]), {
      code: "ITEM_NOT_FOUND",
    });
    await assert.rejects(canvasApi.create({ filename: "../bad.canvas" }), {
      code: "INVALID_ARGUMENT",
    });
    const original = await canvasApi.read(1);
    await canvasApi.update(1, file("Changed"), {
      expectedRevision: original.revision,
    });
    assert.equal((await canvasApi.read(1)).canvas.nodes[0].text, "Changed");
    assert.equal(board.attachmentSyncState, "to_upload");
    assert.equal(saves, 1);
    for (const state of ["to_download", "force_download", "in_conflict"]) {
      await t.test(
        `update reports ${state} as WRITE_CONFLICT without replacing the saved Canvas`,
        async () => {
          const saved = await canvasApi.read(1);
          const previousState = board.attachmentSyncState;
          const previousSaves = saves;
          const text = `Blocked draft during ${state}`;
          board.attachmentSyncState = state;
          try {
            await assert.rejects(
              canvasApi.update(1, file(text), {
                expectedRevision: saved.revision,
              }),
              { code: "WRITE_CONFLICT" },
            );
            assert.equal(disk.get("/board.canvas"), saved.revision);
            assert.equal(board.attachmentSyncState, state);
            assert.equal(saves, previousSaves);
            assert.ok(
              [...disk.entries()].some(([path, content]) => {
                if (
                  !path.startsWith("/data/scholar-canvas/history/1/BOARD001/")
                )
                  return false;
                const version = JSON.parse(content);
                return (
                  version.kind === "draft" &&
                  JSON.parse(version.content).nodes[0].text === text
                );
              }),
              "the rejected API draft remains recoverable outside attachment storage",
            );
          } finally {
            board.attachmentSyncState = previousState;
          }
        },
      );
    }
    await assert.rejects(
      canvasApi.update(1, file("Stale"), {
        expectedRevision: original.revision,
      }),
      { code: "WRITE_CONFLICT" },
    );
    assert.equal((await canvasApi.read(1)).canvas.nodes[0].text, "Changed");
    await t.test(
      "update preserves the native force-upload choice after replacing the Canvas",
      async () => {
        const saved = await canvasApi.read(1);
        const previousState = board.attachmentSyncState;
        const previousSaves = saves;
        board.attachmentSyncState = "force_upload";
        try {
          await canvasApi.update(1, file("Chosen local version"), {
            expectedRevision: saved.revision,
          });
          assert.equal(
            (await canvasApi.read(1)).canvas.nodes[0].text,
            "Chosen local version",
          );
          assert.equal(board.attachmentSyncState, "force_upload");
          assert.equal(saves, previousSaves);
        } finally {
          board.attachmentSyncState = previousState;
        }
      },
    );
    editable = false;
    await assert.rejects(canvasApi.create(), { code: "READ_ONLY" });
    editable = true;
    whiteboardRegistry.register({
      tabID: "test",
      canvasId: "test",
      itemID: 1,
      win: {} as Window,
      path: "/board.canvas",
      title: "Board",
    });
    await assert.rejects(
      canvasApi.update(1, file("Unsafe"), {
        expectedRevision: (await canvasApi.read(1)).revision,
      }),
      { code: "CANVAS_OPEN" },
    );
    whiteboardRegistry.unregister("test");
    await canvasApi.create({ canvas: sources, parentItemID: 2 });
    assert.equal(
      (await canvasApi.read(1)).canvas.nodes[0].bamboo?.node?.kind,
      "literature",
    );
    await t.test("update waits for an opening canvas to register", async () => {
      const saved = await canvasApi.read(1);
      let finishOpening!: () => void;
      const ready = new Promise<void>((resolve) => {
        finishOpening = resolve;
      });
      const opening = whiteboardRegistry.withItemLock(1, async () => {
        await ready;
        whiteboardRegistry.register({
          tabID: "test",
          canvasId: "test",
          itemID: 1,
          win: {} as Window,
          path: "/board.canvas",
          title: "Board",
        });
      });
      const writing = assert.rejects(
        canvasApi.update(1, file("Must not overwrite the loading editor"), {
          expectedRevision: saved.revision,
        }),
        { code: "CANVAS_OPEN" },
      );
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(disk.get("/board.canvas"), saved.revision);
      } finally {
        finishOpening();
        await opening;
        await writing;
        whiteboardRegistry.unregister("test");
      }
      assert.equal(disk.get("/board.canvas"), saved.revision);
    });
    await t.test(
      "opening waits for an API write before reading the file",
      async () => {
        const saved = await canvasApi.read(1);
        const zotero = globals.Zotero as any;
        const io = globals.IOUtils as any;
        const originalWrite = io.writeUTF8;
        const originalRead = zotero.File.getContentsAsync;
        const originalMainWindow = zotero.getMainWindow;
        let finishWrite!: () => void;
        let markWriteStarted!: () => void;
        const pendingWrite = new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
        const writeStarted = new Promise<void>((resolve) => {
          markWriteStarted = resolve;
        });
        let openingRequested = false;
        let openingRead: string | undefined;
        io.writeUTF8 = async (path: string, content: string) => {
          if (path === "/board.canvas") {
            markWriteStarted();
            await pendingWrite;
          }
          return originalWrite(path, content);
        };
        zotero.File.getContentsAsync = async (path: string) => {
          const content = await originalRead(path);
          if (openingRequested && path === "/board.canvas")
            openingRead = content;
          return content;
        };
        // Stop after the real open path reads/parses disk, before mounting its iframe.
        zotero.getMainWindow = () => ({
          Zotero_Tabs: {
            add: () => {
              throw new Error("Test stopped before iframe mount");
            },
          },
        });
        const writing = canvasApi.update(1, file("Written before opening"), {
          expectedRevision: saved.revision,
        });
        let opening: Promise<void> | undefined;
        try {
          await writeStarted;
          openingRequested = true;
          opening = assert.rejects(
            openWhiteboardTab(board as unknown as Zotero.Item),
            /Test stopped before iframe mount/,
          );
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(openingRead, undefined);
          finishWrite();
          await writing;
          await opening;
          assert.equal(
            JSON.parse(openingRead!).nodes[0].text,
            "Written before opening",
          );
        } finally {
          finishWrite();
          await writing;
          await opening;
          io.writeUTF8 = originalWrite;
          zotero.File.getContentsAsync = originalRead;
          zotero.getMainWindow = originalMainWindow;
        }
      },
    );
  } finally {
    whiteboardRegistry.unregister("test");
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete globals[name];
      else globals[name] = previous[index];
    });
  }
});
