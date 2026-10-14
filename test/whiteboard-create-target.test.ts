import assert from "node:assert/strict";
import test from "node:test";
import { createWhiteboardAttachment } from "../src/modules/whiteboard/create.ts";

test("whiteboard creation keeps the selected library and collection on both pane APIs", async (t) => {
  let pane: object;
  let imported: { libraryID?: number; collections?: number[] } | undefined;
  const attachment = { id: 99, attachmentContentType: "application/json" };
  const globals = {
    Zotero: {
      getActiveZoteroPane: () => pane,
      Libraries: {
        userLibraryID: 1,
        get: (id: number) => ([1, 202, 204].includes(id) ? { id } : false),
      },
      Collections: {
        get: (id: number) =>
          id === 303 ? { id, libraryID: 202, deleted: false } : false,
      },
      getTempDirectory: () => ({ path: "/mock-temp" }),
      File: {
        getValidFileName: (value: string) => value,
        putContentsAsync: async () => {},
      },
      Attachments: {
        importFromFile: async (options: typeof imported) => {
          imported = options;
          return attachment;
        },
      },
    },
    IOUtils: { makeDirectory: async () => {}, remove: async () => {} },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    ztoolkit: { log: () => {} },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  for (pane of [
    { getSelectedLibraryID: () => 202, getSelectedCollection: () => 303 },
    {
      getSelectedLibraryIDs: () => [202, 204],
      getSelectedCollections: () => [303, 305],
    },
  ]) {
    assert.equal(
      await createWhiteboardAttachment(null, {
        filename: "Research.canvas",
        select: false,
        reportError: false,
      }),
      attachment,
    );
    assert.equal(imported?.libraryID, 202);
    assert.deepEqual(imported?.collections, [303]);
  }
});
