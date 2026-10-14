import assert from "node:assert/strict";
import test from "node:test";
import {
  openDocumentLink,
  searchDocumentLinks,
} from "../src/modules/markdown/document-links.ts";
import { clearNoteLibraries } from "../src/modules/markdown/note-library.ts";

function makeItem(
  id: number,
  kind = "regular",
  title = "Shared",
  extra: Record<string, unknown> = {},
): any {
  const attachment = ["markdown", "canvas", "attachment"].includes(kind);
  const item: any = {
    id,
    key: `KEY${String(id).padStart(5, "0")}`,
    libraryID: 1,
    rawTitle: title,
    itemTypeID: kind === "regular" ? 1 : kind === "note" ? 2 : 3,
    metadataLoaded: true,
    creatorsLoaded: false,
    creators: [],
    attachmentFilename:
      kind === "markdown"
        ? `${title}.md`
        : kind === "canvas"
          ? `${title}.canvas`
          : "paper.pdf",
    attachmentLinkMode: 0,
    isAttachment: () => attachment,
    isRegularItem: () => kind === "regular",
    isNote: () => kind === "note",
    isPDFAttachment: () => kind === "attachment",
    getField: () => {
      if (!item.metadataLoaded) throw new Error("itemData is not loaded");
      return item.rawTitle;
    },
    getDisplayTitle: () => item.getField("title"),
    getCreators: () => {
      if (!item.creatorsLoaded) throw new Error("creators are not loaded");
      return item.creators;
    },
    getItemTypeIconName: () => (kind === "regular" ? "journalArticle" : kind),
    getImageSrc: () =>
      `chrome://zotero/skin/item-type/16/light/${kind === "regular" ? "journal-article" : kind}.svg`,
    ...extra,
  };
  return item;
}

function install(t: { after: (fn: () => void) => void }, items: any[]) {
  const globals = globalThis as any;
  const previous = globals.Zotero;
  const batches: number[][] = [];
  const dataLoads: string[][] = [];
  const creatorLoads: number[][] = [];
  let fileReads = 0;
  for (const item of items) {
    item.getFilePathAsync = async () => {
      fileReads++;
      return `/notes/${item.id}.md`;
    };
  }
  const record = (id: number) => {
    if (id === 999) throw new Error("Stale tab");
    return items.find((item) => item.id === id);
  };
  globals.Zotero = {
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Libraries: {
      userLibraryID: 1,
      get: (id: number) =>
        id === 7 ? { libraryType: "group", groupID: 42 } : undefined,
    },
    Groups: { get: (id: number) => (id === 42 ? { libraryID: 7 } : undefined) },
    ItemTypes: {
      getLocalizedString: (id: number) =>
        id === 1 ? "期刊论文" : id === 2 ? "笔记" : "附件",
    },
    CreatorTypes: { getID: (name: string) => (name === "author" ? 1 : 2) },
    Search: class {
      conditions: string[][] = [];
      libraryID: number;
      constructor(options: { libraryID: number }) {
        this.libraryID = options.libraryID;
      }
      addCondition(...condition: string[]) {
        this.conditions.push(condition);
      }
      async search() {
        return items
          .filter(
            (item) =>
              item.libraryID === this.libraryID &&
              this.conditions.every(([field, operator, value]) => {
                if (field === "itemType")
                  return value === "note" ? item.isNote() : item.isAttachment();
                // Zotero's title field index excludes itemNotes.title.
                if (field === "title")
                  return (
                    !item.isNote() &&
                    (operator === "is"
                      ? item.rawTitle.toLowerCase() === value.toLowerCase()
                      : item.rawTitle
                          .toLowerCase()
                          .includes(value.toLowerCase()))
                  );
                return true;
              }),
          )
          .map((item) => item.id);
      }
    },
    Items: {
      get: (ids: number | number[]) =>
        Array.isArray(ids) ? ids.map(record).filter(Boolean) : record(ids),
      getAsync: async (ids: number | number[]) => {
        if (Array.isArray(ids)) {
          batches.push(ids);
          return ids.map(record).filter(Boolean);
        }
        return record(ids);
      },
      getAll: async (libraryID: number) =>
        items.filter((item) => item.libraryID === libraryID),
      getByLibraryAndKey: (libraryID: number, key: string) =>
        items.find((item) => item.libraryID === libraryID && item.key === key),
      loadDataTypes: async (records: any[], types: string[]) => {
        dataLoads.push(types);
        if (types.includes("creators"))
          creatorLoads.push(records.map((item) => item.id));
        for (const item of records) {
          if (types.includes("itemData")) item.metadataLoaded = true;
          if (types.includes("creators")) item.creatorsLoaded = true;
        }
      },
    },
    File: { getContentsAsync: async () => "# Shared\n\n## Details\nBody" },
  };
  t.after(() => {
    clearNoteLibraries();
    globals.Zotero = previous;
  });
  return {
    api: globals.Zotero,
    batches,
    dataLoads,
    creatorLoads,
    fileReads: () => fileReads,
  };
}

const current = { id: 1000, libraryID: 1 } as Zotero.Item;

test("regular completion filters before the limit and never reads attachment bodies", async (t) => {
  const items = [
    ...Array.from({ length: 60 }, (_, i) => makeItem(i + 1, "attachment")),
    ...Array.from({ length: 30 }, (_, i) => makeItem(i + 101)),
  ];
  const state = install(t, items);
  const result = await searchDocumentLinks(current, "Shared", false, {
    filter: "regular",
  });
  assert.equal(result.length, 24);
  assert.ok(result.every((candidate) => candidate.kind === "regular"));
  assert.equal(result[0].itemID, 101);
  assert.equal(result[0].kindLabel, "期刊论文");
  assert.match(result[0].icon!, /journal-article\.svg$/);
  assert.ok(state.batches.every((ids) => ids.length <= 48));
  assert.equal(state.fileReads(), 0);
  assert.ok(
    state.dataLoads.every(
      (types) =>
        types.length === 1 && ["itemData", "creators"].includes(types[0]),
    ),
  );
  assert.deepEqual(state.creatorLoads, [
    Array.from({ length: 24 }, (_, i) => i + 101),
  ]);
});

test("all keeps regular matches when an unrelated attachment filename throws", async (t) => {
  const paper = makeItem(1, "regular", "南通水稻种植历史与习俗");
  const foreignFile = makeItem(2, "attachment", "Unrelated attachment");
  Object.defineProperty(foreignFile, "attachmentFilename", {
    get: () => {
      throw new Error("PathUtils.filename: NS_ERROR_FILE_UNRECOGNIZED_PATH");
    },
  });
  const laterNote = makeItem(3, "note", "南通研究笔记");
  const state = install(t, [paper, foreignFile, laterNote]);
  const regular = await searchDocumentLinks(current, "南通", false, {
    filter: "regular",
  });
  const all = await searchDocumentLinks(current, "南通", false, {
    filter: "all",
  });
  assert.deepEqual(
    regular.map((candidate) => candidate.itemID),
    [1],
  );
  assert.deepEqual(
    all.map((candidate) => candidate.itemID),
    [1, 3],
  );
  assert.equal(state.fileReads(), 0);
  // Even that attachment remains addressable by its valid title.
  const attachment = await searchDocumentLinks(current, "Unrelated", false, {
    filter: "all",
  });
  assert.equal(attachment[0]?.href, "zotero://select/library/items/KEY00002");
});

test("all retains title matches if either supplementary index fails", async (t) => {
  const state = install(t, [
    makeItem(1, "regular", "南通文献"),
    makeItem(2, "note", "南通笔记"),
  ]);
  const Search = state.api.Search;
  for (const failedType of ["attachment", "note"]) {
    state.api.Search = class extends Search {
      async search() {
        if (
          this.conditions.some(
            ([field, , value]: string[]) =>
              field === "itemType" && value === failedType,
          )
        )
          throw new Error("Unavailable supplementary index");
        return super.search();
      }
    };
    const result = await searchDocumentLinks(current, "南通", false, {
      filter: "all",
    });
    assert.equal(result[0]?.itemID, 1);
    if (failedType === "attachment") assert.equal(result[1]?.itemID, 2);
  }
});

test("a broken candidate does not discard other records from its batch", async (t) => {
  const broken = makeItem(2, "attachment");
  Object.defineProperty(broken, "attachmentLinkMode", {
    get: () => {
      throw new Error("Malformed attachment record");
    },
  });
  broken.getField = () => {
    throw new Error("Unavailable title");
  };
  broken.getDisplayTitle = () => {
    throw new Error("Unavailable title");
  };
  broken.isAttachment = () => {
    throw new Error("Unavailable attachment metadata");
  };
  const state = install(t, [makeItem(1), broken, makeItem(3)]);
  // The native title index returns IDs without invoking record getters.
  state.api.Search.prototype.search = async function () {
    return this.conditions.some(([field]: string[]) => field === "itemType")
      ? []
      : [1, 2, 3];
  };
  const result = await searchDocumentLinks(current, "Shared", false, {
    filter: "all",
  });
  assert.deepEqual(
    result.map((candidate) => candidate.itemID),
    [1, 3],
  );
});

test("completion shows the first actual author and inherits parent authors without reading bodies", async (t) => {
  const items = [
    makeItem(1, "regular", "Shared Chinese", {
      creators: [
        {
          creatorTypeID: 2,
          firstName: "Not",
          lastName: "Author",
          fieldMode: 0,
        },
        { creatorTypeID: 1, firstName: "三", lastName: "张", fieldMode: 0 },
        { creatorTypeID: 1, firstName: "四", lastName: "李", fieldMode: 0 },
      ],
    }),
    makeItem(2, "regular", "Shared English", {
      creators: [
        {
          creatorTypeID: 1,
          firstName: " Jane ",
          lastName: " Doe ",
          fieldMode: 0,
        },
      ],
    }),
    makeItem(3, "regular", "Shared organization", {
      creators: [
        {
          creatorTypeID: 1,
          firstName: "Ignored",
          lastName: "World Health Organization",
          fieldMode: 1,
        },
      ],
    }),
    makeItem(4, "regular", "Shared no author", {
      creators: [
        {
          creatorTypeID: 2,
          firstName: "Only",
          lastName: "Editor",
          fieldMode: 0,
        },
      ],
    }),
    makeItem(5, "attachment", "Shared PDF", { parentItemID: 1 }),
    makeItem(6, "note", "Shared note", { parentItemID: 2 }),
    makeItem(7, "markdown", "Shared markdown", { parentItemID: 3 }),
    makeItem(8, "attachment", "Shared standalone"),
    makeItem(9, "regular", "Unrelated", {
      creators: [{ creatorTypeID: 1, lastName: "Unused" }],
    }),
  ];
  const state = install(t, items);
  const result = await searchDocumentLinks(current, "Shared", false, {
    filter: "all",
  });
  const byID = new Map(
    result.map((candidate) => [candidate.itemID, candidate.author]),
  );
  assert.equal(byID.get(1), "张三");
  assert.equal(byID.get(2), "Jane Doe");
  assert.equal(byID.get(3), "World Health Organization");
  assert.equal(byID.get(4), undefined);
  assert.equal(byID.get(5), "张三");
  assert.equal(byID.get(6), "Jane Doe");
  assert.equal(byID.get(7), "World Health Organization");
  assert.equal(byID.get(8), undefined);
  assert.deepEqual(state.creatorLoads, [[1, 2, 3, 4]]);
  assert.equal(state.fileReads(), 0);
});

test("unavailable or oversized author metadata cannot invalidate candidate results", async (t) => {
  const items = [
    makeItem(1, "regular", "Shared long", {
      creators: [{ creatorTypeID: 1, lastName: "名".repeat(250) }],
    }),
    makeItem(2, "regular", "Shared blank", {
      creators: [{ creatorTypeID: 1, lastName: "   " }],
    }),
    makeItem(3, "regular", "Shared unavailable"),
  ];
  const state = install(t, items);
  const load = state.api.Items.loadDataTypes;
  state.api.Items.loadDataTypes = async (records: any[], types: string[]) => {
    if (types.includes("creators") && records.some((item) => item.id === 3))
      throw new Error("Unavailable creators");
    return load(records, types);
  };
  const result = await searchDocumentLinks(current, "Shared", false, {
    filter: "all",
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].author?.length, 200);
  assert.equal(result[1].author, undefined);
  assert.equal(result[2].author, undefined);
});

test("all and notes/attachments include native note titles, documents and generic attachments", async (t) => {
  const items = [
    makeItem(1),
    makeItem(2, "markdown"),
    makeItem(3, "canvas"),
    makeItem(4, "note"),
    makeItem(5, "attachment"),
    makeItem(6, "annotation"),
  ];
  const state = install(t, items);
  const all = await searchDocumentLinks(current, "Shared", false, {
    filter: "all",
  });
  assert.deepEqual(
    new Set(all.map((candidate) => candidate.kind)),
    new Set(["regular", "markdown", "canvas", "note", "attachment"]),
  );
  const documents = await searchDocumentLinks(current, "", false, {
    filter: "notes-attachments",
  });
  assert.deepEqual(
    new Set(documents.map((candidate) => candidate.kind)),
    new Set(["markdown", "canvas", "note", "attachment"]),
  );
  assert.equal(
    documents.find((candidate) => candidate.kind === "note")?.href,
    "zotero://select/library/items/KEY00004",
  );
  assert.equal(
    documents.find((candidate) => candidate.kind === "attachment")?.kindLabel,
    "PDF",
  );
  assert.equal(state.fileReads(), 0);
});

test("Markdown filename aliases use metadata while heading completion uses the current draft", async (t) => {
  const note = makeItem(1, "markdown", "Unrelated title", {
    attachmentFilename: "Actual-file.md",
  });
  const state = install(t, [note]);
  const result = await searchDocumentLinks(note, "Actual-file", false, {
    filter: "notes-attachments",
  });
  assert.equal(result[0]?.href, "Actual-file--KEY00001.md");
  assert.equal(state.fileReads(), 0);
  const heading = await searchDocumentLinks(
    note,
    "Actual-file#Unsaved",
    false,
    { filter: "notes-attachments", currentContent: "# Unsaved heading" },
  );
  assert.equal(heading[0]?.heading, "Unsaved heading");
  assert.match(heading[0]?.href || "", /#Unsaved%20heading$/);
});

test("every explicit scope excludes deleted items and children of deleted parents", async (t) => {
  const parent = makeItem(1, "regular", "Shared parent", { deleted: true });
  const child = makeItem(2, "note", "Shared child", { parentItemID: 1 });
  const deleted = makeItem(3, "attachment", "Shared deleted", {
    deleted: true,
  });
  const live = makeItem(4, "note", "Shared alive");
  install(t, [parent, child, deleted, live]);
  const win = {
    Zotero_Tabs: {
      getState: () =>
        [2, 3, 4].map((itemID) => ({ type: "note", data: { itemID } })),
    },
  } as unknown as Window;
  for (const filter of ["all", "notes-attachments", "open"] as const) {
    const result = await searchDocumentLinks(current, "Shared", false, {
      filter,
      win,
    });
    assert.deepEqual(
      result.map((candidate) => candidate.itemID),
      [4],
    );
  }
  assert.deepEqual(
    await searchDocumentLinks(current, "Shared", false, { filter: "regular" }),
    [],
  );
});

test("open tabs include parents, deduplicate, preserve cross-library identity and survive a stale tab", async (t) => {
  const items = [
    makeItem(1, "attachment", "Shared PDF", {
      parentItemID: 10,
      metadataLoaded: false,
    }),
    makeItem(10, "regular", "Shared paper", { metadataLoaded: false }),
    makeItem(2, "markdown", "Shared group MD", {
      libraryID: 7,
      key: "KEY00001",
      parentItemID: 20,
      metadataLoaded: false,
    }),
    makeItem(20, "regular", "Shared group paper", {
      libraryID: 7,
      metadataLoaded: false,
    }),
    makeItem(3, "canvas", "Shared unknown library", { libraryID: 8 }),
    makeItem(4, "note", "Shared unopened"),
  ];
  const state = install(t, items);
  const win = {
    Zotero_Tabs: {
      getState: () =>
        [1, 2, 2, 3, 999].map((itemID) => ({
          type: "reader-unloaded",
          data: { itemID },
        })),
    },
  } as unknown as Window;
  const result = await searchDocumentLinks(current, "Shared", false, {
    filter: "open",
    win,
  });
  assert.deepEqual(
    result.map((candidate) => candidate.itemID),
    [1, 10, 2, 20],
  );
  const group = result.find((candidate) => candidate.itemID === 2)!;
  assert.equal(group.groupID, 42);
  assert.equal(group.href, "zotero://select/groups/42/items/KEY00001");
  assert.equal(
    group.filename,
    undefined,
    "cross-library MD must not become a relative file link",
  );
  assert.equal(state.fileReads(), 0);
  assert.ok(
    items
      .filter((item) => [1, 10, 2, 20].includes(item.id))
      .every((item) => item.metadataLoaded),
  );
});

test("host icons never expose arbitrary URLs and are resolved once per native type", async (t) => {
  let calls = 0;
  const items = [
    makeItem(1, "regular", "Safe", {
      getItemTypeIconName: () => "testSafeType",
      getImageSrc: () => {
        calls++;
        return "chrome://zotero/skin/item-type/16/light/book.svg";
      },
    }),
    makeItem(2, "regular", "Unsafe", {
      getItemTypeIconName: () => "testUnsafeType",
      getImageSrc: () => "https://example.com/tracking.png",
    }),
  ];
  install(t, items);
  const first = await searchDocumentLinks(current, "", false, {
    filter: "regular",
  });
  await searchDocumentLinks(current, "", false, { filter: "regular" });
  assert.equal(
    first[0].icon,
    "chrome://zotero/skin/item-type/16/light/book.svg",
  );
  assert.equal(first[1].icon, undefined);
  assert.equal(calls, 1);
});

test("native notes and attachments use host open APIs while regular links select their item", async (t) => {
  const items = [makeItem(1, "note"), makeItem(2, "attachment"), makeItem(3)];
  install(t, items);
  const calls: string[] = [];
  const win = {
    ZoteroPane: {
      openNote: async (id: number) => {
        calls.push(`note:${id}`);
      },
      viewAttachment: async (id: number) => {
        calls.push(`attachment:${id}`);
      },
      selectItem: async (id: number) => {
        calls.push(`select:${id}`);
      },
    },
  } as unknown as Window;
  for (const item of items) {
    assert.equal(
      (
        await openDocumentLink(`zotero://select/library/items/${item.key}`, {
          win,
        })
      ).status,
      "opened",
    );
  }
  assert.deepEqual(calls, ["note:1", "attachment:2", "select:3"]);
  items[0].deleted = true;
  assert.equal(
    (await openDocumentLink("zotero://select/library/items/KEY00001", { win }))
      .status,
    "unresolved",
  );
  assert.equal(calls.length, 3);
});
