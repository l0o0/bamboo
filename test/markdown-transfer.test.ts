import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, win32 } from "node:path";
import test, { type TestContext } from "node:test";
import { importMarkdownFile } from "../src/modules/markdown/transfer.ts";
import {
  buildNoteExport,
  exportSelectedNotes,
} from "../src/modules/markdown/export-notes.ts";
import { clearNoteLibraries } from "../src/modules/markdown/note-library.ts";

// Gecko appends each argument after the absolute base as one leaf component.
// node:path.join would incorrectly accept "assets/image.png" as one component.
function strictJoin(base: string, ...components: string[]) {
  for (const component of components) {
    if (!component || /[\\/\0]/.test(component) || component === "..")
      throw new Error(
        "PathUtils.join: Could not append to path: NS_ERROR_FILE_UNRECOGNIZED_PATH",
      );
  }
  return /^[A-Za-z]:\\|^\\\\/.test(base)
    ? win32.join(base, ...components)
    : join(base, ...components);
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "scholar-transfer-"));
  const source = join(directory, "source");
  const temp = join(directory, "temp");
  const storage = join(directory, "storage");
  const output = join(directory, "output");
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils", "ztoolkit", "addon"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const library = { libraryID: 1, editable: true, filesEditable: true };
  const parent = {
    id: 7,
    libraryID: 1,
    deleted: false,
    isRegularItem: () => true,
    isEditable: () => library.editable,
  };
  const items = new Map<number, any>([[7, parent]]);
  const imports: any[] = [];
  const erased: number[] = [];
  let picker: string | null = null;
  let failSave = false;
  let failWrite = "";
  let afterRead: ((path: string) => Promise<void>) | undefined;
  let afterWrite: ((path: string) => Promise<void>) | undefined;
  const api = {
    Libraries: { userLibraryID: 1, get: () => library },
    Collections: {
      get: (id: number) => (id === 10 ? { id, libraryID: 1 } : false),
    },
    Items: {
      get: (id: number) => items.get(id),
      getAll: () => {
        throw new Error("Must not scan the library");
      },
    },
    File: {
      getContentsAsync: async (path: string) => {
        const content = await readFile(path, "utf8");
        await afterRead?.(path);
        return content;
      },
      putContentsAsync: async (path: string, content: string) => {
        if (failWrite && path.includes(failWrite)) throw new Error("Disk full");
        await writeFile(path, content);
        await afterWrite?.(path);
      },
      pathToFile: (path: string) => ({
        isSymlink: () => lstatSync(path).isSymbolicLink(),
      }),
    },
    getTempDirectory: () => ({ path: temp }),
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      LINK_MODE_LINKED_URL: 3,
      importSnapshotFromFile: async (options: any) => {
        imports.push(options);
        const id = 100 + imports.length;
        const folder = join(storage, String(id));
        await cp(dirname(options.file), folder, { recursive: true });
        let state = 0;
        const item = {
          id,
          libraryID: 1,
          key: `NOTE${String(id).padStart(4, "0")}`,
          parentItemID: options.parentItemID,
          attachmentFilename: basename(options.file),
          attachmentContentType: "text/markdown",
          attachmentLinkMode: 1,
          attachmentSyncedModificationTime: 0,
          isAttachment: () => true,
          isStoredFileAttachment: () => true,
          getField: () => options.title,
          getFilePathAsync: async () => join(folder, basename(options.file)),
          get attachmentSyncState() {
            return state;
          },
          set attachmentSyncState(value: string | number) {
            state = value === "to_upload" ? 0 : Number(value);
          },
          setCollections: (ids: number[]) => {
            (item as any).collections = ids;
          },
          saveTx: async () => {
            if (failSave) throw new Error("Metadata save failed");
          },
          eraseTx: async () => {
            erased.push(id);
            items.delete(id);
            await rm(folder, { recursive: true, force: true });
          },
        };
        items.set(id, item);
        return item;
      },
    },
  };
  Object.assign(globalThis, {
    Zotero: api,
    PathUtils: { join: strictJoin, parent: dirname, filename: basename },
    IOUtils: {
      exists: async (path: string) => existsSync(path),
      makeDirectory: async (path: string, options: any = {}) =>
        mkdir(path, {
          recursive: Boolean(options.ignoreExisting || options.createAncestors),
        }),
      read: async (path: string) => {
        const content = await readFile(path);
        await afterRead?.(path);
        return content;
      },
      write: async (path: string, bytes: Uint8Array) => {
        if (failWrite && path.includes(failWrite)) throw new Error("Disk full");
        await writeFile(path, bytes);
        await afterWrite?.(path);
      },
      stat: async (path: string) => {
        const info = await stat(path);
        return {
          type: info.isFile() ? "regular" : "directory",
          size: info.size,
          lastModified: info.mtimeMs,
        };
      },
      remove: (path: string, options: any) =>
        rm(path, { recursive: options?.recursive, force: true }),
      setModificationTime: (path: string, time: number) =>
        utimes(path, new Date(time), new Date(time)),
    },
    ztoolkit: {
      log() {},
      getGlobal() {},
      FilePicker: class {
        async open() {
          return picker;
        }
      },
    },
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
    },
  });
  t.after(() => {
    clearNoteLibraries();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    source,
    temp,
    storage,
    output,
    api,
    library,
    parent,
    items,
    imports,
    erased,
    async setup() {
      for (const path of [source, temp, storage, output]) await mkdir(path);
    },
    setPicker: (path: string | null) => {
      picker = path;
    },
    setFailSave: () => {
      failSave = true;
    },
    setFailWrite: (path: string) => {
      failWrite = path;
    },
    setAfterRead: (callback: typeof afterRead) => {
      afterRead = callback;
    },
    setAfterWrite: (callback: typeof afterWrite) => {
      afterWrite = callback;
    },
  };
}

test("Markdown import commits referenced images together, flattens names and retains original files", async (t) => {
  const f = fixture(t);
  await f.setup();
  await mkdir(join(f.source, "pictures"));
  await writeFile(
    join(f.source, "pictures", "figure(1).png"),
    new Uint8Array([1, 2, 3]),
  );
  await writeFile(join(f.source, "figure(1).png"), new Uint8Array([4, 5]));
  await writeFile(join(f.source, "unreferenced.png"), new Uint8Array([9]));
  const path = join(f.source, "Research.md");
  const original =
    '# Research\n![a](pictures/figure(1).png "Caption")\n![[figure(1).png|300]]\n![again][fig]\n\n[fig]: <pictures/figure(1).png> "Title"\n\n[[Other note]]\n```\n![ignore](absent.png)\n```';
  await writeFile(path, original);
  const imported = await importMarkdownFile(
    {} as Window,
    { parent: f.parent as any, libraryID: 1 },
    { sourcePath: path },
  );
  assert.ok(imported);
  assert.equal(f.imports[0].parentItemID, 7);
  assert.equal(f.imports[0].libraryID, undefined);
  assert.equal(imported.attachmentLinkMode, 0);
  const content = await readFile((await imported.getFilePathAsync())!, "utf8");
  assert.match(content, /assets\/figure%281%29\.png "Caption"/);
  assert.match(content, /!\[\[assets\/figure\(1\)-2\.png\|300\]\]/);
  assert.match(content, /\[fig\]: <assets\/figure%281%29\.png> "Title"/);
  assert.match(content, /\[\[Other note\]\]/);
  assert.match(content, /!\[ignore\]\(absent\.png\)/);
  assert.deepEqual(
    readdirSync(join(f.storage, String(imported.id), "assets")).sort(),
    ["figure(1)-2.png", "figure(1).png"],
  );
  assert.equal(
    existsSync(join(f.storage, String(imported.id), "unreferenced.png")),
    false,
  );
  assert.deepEqual(readdirSync(f.temp), []);
  assert.equal(readFileSync(path, "utf8"), original);
});

test("import cancellation, read-only destinations and missing images never create attachment records", async (t) => {
  const f = fixture(t);
  await f.setup();
  assert.equal(await importMarkdownFile({} as Window, { libraryID: 1 }), null);
  const path = join(f.source, "Note.md");
  await writeFile(path, "![missing](absent.png)");
  await assert.rejects(
    importMarkdownFile({} as Window, { libraryID: 1 }, { sourcePath: path }),
    /unavailable/,
  );
  assert.equal(f.imports.length, 0);
  assert.deepEqual(readdirSync(f.temp), []);
  f.library.filesEditable = false;
  await assert.rejects(
    importMarkdownFile({} as Window, { libraryID: 1 }, { sourcePath: path }),
    /read-only/,
  );
  assert.equal(f.imports.length, 0);
});

test("unsupported formats and symlink images are rejected without changing their source", async (t) => {
  const f = fixture(t);
  await f.setup();
  const path = join(f.source, "Note.md");
  await writeFile(join(f.source, "image.svg"), "<svg></svg>");
  await writeFile(path, "![vector](image.svg)");
  await assert.rejects(
    importMarkdownFile({} as Window, { libraryID: 1 }, { sourcePath: path }),
    /Unsupported local image format/,
  );
  await writeFile(join(f.source, "private.txt"), "private contents");
  await symlink(join(f.source, "private.txt"), join(f.source, "image.png"));
  await writeFile(path, "![link](image.png)");
  await assert.rejects(
    importMarkdownFile({} as Window, { libraryID: 1 }, { sourcePath: path }),
    /Symbolic-link/,
  );
  assert.equal(f.imports.length, 0);
  assert.equal(
    readFileSync(join(f.source, "private.txt"), "utf8"),
    "private contents",
  );
  assert.deepEqual(readdirSync(f.temp), []);
});

test("a failed metadata save or disposal after native import erases only the newly created package", async (t) => {
  const f = fixture(t);
  await f.setup();
  const path = join(f.source, "Note.md");
  await writeFile(path, "# Keep me");
  f.setFailSave();
  await assert.rejects(
    importMarkdownFile(
      {} as Window,
      { libraryID: 1, collectionID: 10 },
      { sourcePath: path },
    ),
    /Metadata save failed/,
  );
  assert.deepEqual(f.erased, [101]);
  assert.deepEqual(readdirSync(f.storage), []);
  assert.equal(readFileSync(path, "utf8"), "# Keep me");
  assert.deepEqual(readdirSync(f.temp), []);
  assert.equal(
    await importMarkdownFile(
      {} as Window,
      { libraryID: 1 },
      { sourcePath: path, shouldContinue: () => f.imports.length < 2 },
    ),
    null,
  );
  assert.deepEqual(f.erased, [101, 102]);
  assert.deepEqual(readdirSync(f.storage), []);
});

test("selected export prepares only explicit files, remaps images safely and never scans a library", async (t) => {
  const f = fixture(t);
  await f.setup();
  const path = join(f.source, "Selected.md");
  await writeFile(
    path,
    '![image](figure(1).png "Title")\n```\n![image](figure(1).png)\n```',
  );
  await writeFile(join(f.source, "figure(1).png"), new Uint8Array([1]));
  const item: any = {
    id: 1,
    key: "SELECT01",
    libraryID: 1,
    attachmentFilename: "Selected.md",
    attachmentLinkMode: 0,
    isAttachment: () => true,
    getField: () => "Selected",
    getFilePathAsync: async () => path,
  };
  f.items.set(1, item);
  const remapped = buildNoteExport(
    [
      {
        libraryID: 1,
        key: item.key,
        filename: item.attachmentFilename,
        title: "Selected",
        content: readFileSync(path, "utf8"),
      },
    ],
    {
      format: "wiki",
      assetPaths: new Map([["1:SELECT01:figure(1).png", "assets/hash.png"]]),
    },
  );
  assert.match(
    remapped.files[0].content,
    /!\[image\]\(assets\/hash\.png "Title"\)/,
  );
  assert.match(
    remapped.files[0].content,
    /```\n!\[image\]\(figure\(1\)\.png\)\n```/,
  );
  f.setPicker(f.output);
  const exported = await exportSelectedNotes(
    {} as Window,
    [item, item],
    "markdown",
  );
  assert.ok(exported);
  assert.equal(exported.notes, 1);
  assert.equal(
    existsSync(
      join(
        exported.directory,
        "assets",
        "SELECT01",
        "linked",
        "1",
        "figure(1).png",
      ),
    ),
    true,
  );
  f.setFailWrite("zotero-markdown-export-1");
  await assert.rejects(
    exportSelectedNotes({} as Window, [item], "markdown"),
    /Disk full/,
  );
  assert.deepEqual(readdirSync(f.output), ["zotero-markdown-export"]);
});

for (const sourceKind of ["Markdown", "image"] as const) {
  for (const phase of ["while reading", "after writing"] as const) {
    test(`selected export rejects a ${sourceKind} change ${phase} and removes only its own directory`, async (t) => {
      const f = fixture(t);
      await f.setup();
      const path = join(f.source, "Selected.md");
      const image = join(f.source, "figure.png");
      await writeFile(path, "# Before\n![image](figure.png)");
      await writeFile(image, new Uint8Array([1]));
      const selected: any = {
        id: 1,
        key: "SELECT01",
        libraryID: 1,
        attachmentFilename: "Selected.md",
        attachmentLinkMode: 0,
        isAttachment: () => true,
        getField: () => "Selected",
        getFilePathAsync: async () => path,
      };
      f.items.set(1, selected);
      const existing = join(f.output, "zotero-markdown-export");
      await mkdir(existing);
      await writeFile(join(existing, "Keep.md"), "User-owned export");
      f.setPicker(f.output);
      let changed = false;
      const mutate = async () => {
        changed = true;
        // Different lengths make the stamp change deterministic on filesystems
        // with coarse modification timestamps; no timers or races are needed.
        if (sourceKind === "Markdown")
          await writeFile(
            path,
            "# Changed after export started\n![image](figure.png)",
          );
        else await writeFile(image, new Uint8Array([2, 3, 4]));
      };
      if (phase === "while reading") {
        f.setAfterRead(async (source) => {
          if (!changed && source === (sourceKind === "Markdown" ? path : image))
            await mutate();
        });
      } else {
        f.setAfterWrite(async (target) => {
          // Mutate after its export copy has been written, before the final
          // validation. This also verifies cleanup of a partially copied tree.
          if (
            !changed &&
            target.startsWith(f.output) &&
            target.endsWith("figure.png")
          )
            await mutate();
        });
      }
      await assert.rejects(
        exportSelectedNotes({} as Window, [selected]),
        /source.*changed during export/i,
      );
      assert.equal(changed, true);
      assert.deepEqual(readdirSync(f.output), ["zotero-markdown-export"]);
      assert.equal(
        readFileSync(join(existing, "Keep.md"), "utf8"),
        "User-owned export",
      );
      if (sourceKind === "Markdown")
        assert.match(readFileSync(path, "utf8"), /^# Changed/);
      else assert.deepEqual([...readFileSync(image)], [2, 3, 4]);
    });
  }
}

test("HTML image import relocates the actual src while preserving data-src and quoted attribute contents", async (t) => {
  const f = fixture(t);
  await f.setup();
  const path = join(f.source, "HTML.md");
  const original = [
    '<img data-src="preview.png" src="actual.png" alt="Figure">',
    '<img alt="src=other.png" src=actual.png>',
    "<img title=\"src='other.png'\" src='actual.png'>",
  ].join("\n");
  await writeFile(path, original);
  await writeFile(join(f.source, "actual.png"), new Uint8Array([1, 2, 3]));
  const imported = await importMarkdownFile(
    {} as Window,
    { libraryID: 1 },
    { sourcePath: path },
  );
  assert.ok(imported);
  const content = await readFile((await imported.getFilePathAsync())!, "utf8");
  assert.equal(content, original.replaceAll("actual.png", "assets/actual.png"));
  assert.deepEqual(
    readdirSync(join(f.storage, String(imported.id), "assets")),
    ["actual.png"],
  );
  assert.equal(readFileSync(path, "utf8"), original);
});

for (const windowsRoot of [
  String.raw`C:\研究资料`,
  String.raw`\\server\共享\研究资料`,
]) {
  test(`image export and import honor native Windows paths under ${windowsRoot}`, async (t) => {
    const f = fixture(t);
    await f.setup();
    const globals = globalThis as Record<string, any>;
    const toNative = (path: string) =>
      win32.join(windowsRoot, ...relative(f.directory, path).split("/"));
    const toDisk = (path: string) => {
      assert.ok(
        win32.isAbsolute(path),
        `Expected a native absolute path: ${path}`,
      );
      assert.equal(
        path.includes("/"),
        false,
        `Native Windows paths cannot contain URL slashes: ${path}`,
      );
      const child = win32.relative(windowsRoot, path);
      assert.equal(child.startsWith(".."), false);
      return join(f.directory, ...child.split("\\"));
    };
    const joins: string[][] = [];
    globals.PathUtils = {
      join: (base: string, ...parts: string[]) => {
        toDisk(base);
        joins.push([base, ...parts]);
        return strictJoin(base, ...parts);
      },
      parent: (path: string) => {
        toDisk(path);
        return win32.dirname(path);
      },
      filename: (path: string) => {
        toDisk(path);
        return win32.basename(path);
      },
    };
    // Execute the actual transfer flow with native Windows paths while keeping
    // the test's file IO inside its disposable directory on any host OS.
    for (const [owner, methods] of [
      [
        globals.IOUtils,
        [
          "exists",
          "makeDirectory",
          "read",
          "write",
          "stat",
          "remove",
          "setModificationTime",
        ],
      ],
      [f.api.File, ["getContentsAsync", "putContentsAsync", "pathToFile"]],
    ] as const) {
      for (const method of methods) {
        const original = owner[method];
        owner[method] = (path: string, ...args: unknown[]) =>
          original.call(owner, toDisk(path), ...args);
      }
    }
    f.api.getTempDirectory = () => ({ path: toNative(f.temp) });
    const nativeImport = f.api.Attachments.importSnapshotFromFile;
    f.api.Attachments.importSnapshotFromFile = async (options: any) => {
      const imported = await nativeImport({
        ...options,
        file: toDisk(options.file),
      });
      const file = await imported.getFilePathAsync();
      imported.getFilePathAsync = async () => toNative(file);
      return imported;
    };
    await mkdir(join(f.source, "pictures", "资料"), { recursive: true });
    await mkdir(join(f.directory, "shared"));
    await writeFile(
      join(f.source, "pictures", "资料", "figure.png"),
      new Uint8Array([1, 2]),
    );
    await writeFile(
      join(f.directory, "shared", "other.png"),
      new Uint8Array([3, 4]),
    );
    const source = join(f.source, "Note.md");
    await writeFile(
      source,
      "![nested](pictures/资料/figure.png)\n![parent](../shared/other.png)",
    );
    const selected: any = {
      id: 1,
      key: "WINNOTE1",
      libraryID: 1,
      attachmentFilename: "Note.md",
      attachmentLinkMode: 0,
      isAttachment: () => true,
      getField: () => "Note",
      getFilePathAsync: async () => toNative(source),
    };
    f.items.set(1, selected);
    f.setPicker(toNative(f.output));
    const exported = await exportSelectedNotes({} as Window, [selected]);
    assert.ok(exported);
    assert.deepEqual(exported.warnings, []);
    const exportedDirectory = toDisk(exported.directory);
    const exportedContent = await readFile(
      join(exportedDirectory, "Note--WINNOTE1.md"),
      "utf8",
    );
    assert.match(exportedContent, /assets\/WINNOTE1\/linked\/1\/figure\.png/);
    assert.match(exportedContent, /assets\/WINNOTE1\/linked\/2\/other\.png/);
    assert.deepEqual(
      [
        ...(await readFile(
          join(
            exportedDirectory,
            "assets",
            "WINNOTE1",
            "linked",
            "1",
            "figure.png",
          ),
        )),
      ],
      [1, 2],
    );
    assert.deepEqual(
      [
        ...(await readFile(
          join(
            exportedDirectory,
            "assets",
            "WINNOTE1",
            "linked",
            "2",
            "other.png",
          ),
        )),
      ],
      [3, 4],
    );
    assert.ok(
      joins.some(
        (parts) =>
          parts.slice(1).join("/") === "assets/WINNOTE1/linked/1/figure.png",
      ),
    );
    const imported = await importMarkdownFile(
      {} as Window,
      { libraryID: 1 },
      { sourcePath: toNative(source) },
    );
    assert.ok(imported);
    const importedPath = toDisk((await imported.getFilePathAsync())!);
    assert.equal(
      await readFile(importedPath, "utf8"),
      "![nested](assets/figure.png)\n![parent](assets/other.png)",
    );
    assert.deepEqual(
      [
        ...(await readFile(
          join(dirname(importedPath), "assets", "figure.png"),
        )),
      ],
      [1, 2],
    );
    assert.deepEqual(
      [...(await readFile(join(dirname(importedPath), "assets", "other.png")))],
      [3, 4],
    );
    assert.deepEqual(readdirSync(f.temp), []);
  });
}
