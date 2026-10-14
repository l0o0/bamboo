import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

type Host = Window & {
  ZoteroPane: {
    getSelectedItems(): Item[];
    selectItem(id: number): Promise<void>;
  };
};
type Item = ReturnType<typeof makeItem>;
function makeItem(
  id: number,
  options: {
    parent?: number;
    libraryID?: number;
    kind?: "regular" | "md" | "pdf";
    deleted?: boolean;
    editable?: boolean;
    children?: number[];
  } = {},
) {
  return {
    id,
    libraryID: options.libraryID ?? 1,
    parentItemID: options.parent,
    deleted: options.deleted ?? false,
    attachmentFilename: `${id}.${options.kind === "pdf" ? "pdf" : "md"}`,
    isRegularItem: () => !options.kind || options.kind === "regular",
    isAttachment: () => options.kind === "md" || options.kind === "pdf",
    isEditable: () => options.editable !== false,
    getAttachments: () => options.children ?? [],
  };
}

function fixture(t: TestContext) {
  const windows: Host[] = [];
  const items = new Map<number, Item>();
  const calls: Array<{
    kind: string;
    parent: Item;
    options: Record<string, unknown>;
  }> = [];
  const exports: Array<{ win: Host; items: Item[] }> = [];
  const opened: Array<{ kind: string; win: Host; item: Item }> = [];
  const libraries = new Map([
    [1, { editable: true, filesEditable: true }],
    [2, { editable: true, filesEditable: true }],
  ]);
  let pending: Promise<Item> | undefined;
  let nextID = 100;
  const create = async (
    kind: string,
    parent: Item,
    options: Record<string, unknown>,
  ) => {
    calls.push({ kind, parent, options });
    return (
      pending ??
      makeItem(++nextID, {
        kind: "md",
        parent: parent.id,
        libraryID: parent.libraryID,
      })
    );
  };
  const open = async (kind: string, item: Item, options: { win: Host }) => {
    opened.push({ kind, item, win: options.win });
    return `${kind}-${item.id}`;
  };
  const mocks: Record<string, unknown> = {
    "./annotations": { showAnnotationExport: async () => {} },
    "../file-history-ui": { registerFileHistoryMenu: () => () => {} },
    "../../utils/locale": { getString: (key: string) => key },
    "../../utils/prefs": { getPref: () => undefined },
    "./create": {
      createMarkdownAttachment: (
        parent: Item,
        options: Record<string, unknown>,
      ) => create("markdown", parent, options),
    },
    "../whiteboard/create": {
      createWhiteboardAttachment: (
        parent: Item,
        options: Record<string, unknown>,
      ) => create("whiteboard", parent, options),
    },
    "./detect": {
      isMarkdownAttachment: (item: Item) =>
        item.isAttachment() && item.attachmentFilename.endsWith(".md"),
    },
    "./shortcut": { resolveConfiguredShortcut: () => undefined },
    "./window": { openMarkdownWindow: async () => {} },
    "./tab": {
      openMarkdownTab: (item: Item, options: { win: Host }) =>
        open("markdown", item, options),
    },
    "../whiteboard/tab": {
      openWhiteboardTab: (item: Item, options: { win: Host }) =>
        open("whiteboard", item, options),
    },
    "../whiteboard/open": { rememberWhiteboard: () => {} },
    "./export-notes": {
      exportSelectedNotes: async (win: Host, selected: Item[]) => {
        exports.push({ win, items: selected });
        return null;
      },
    },
  };
  const module = { exports: {} as Record<string, unknown> };
  const code = transpileModule(
    readFileSync(
      new URL("../src/modules/markdown/menu.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.CommonJS,
      },
    },
  ).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    addon: {
      data: { config: { addonRef: "bamboo", addonName: "Scholar Sketch" } },
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
      Libraries: { get: (id: number) => libraries.get(id) },
      Items: { get: (id: number) => items.get(id) },
      getActiveZoteroPane() {
        throw new Error("Must use the owning window");
      },
    },
  });
  const menus = module.exports as {
    registerItemContextMenu(win: Host): void;
    unregisterItemContextMenu(win: Host): void;
    unregisterMenus(): void;
  };
  function makeWindow() {
    const win = new Window() as Host;
    windows.push(win);
    const state = { selection: [] as Item[], selectedIDs: [] as number[] };
    win.ZoteroPane = {
      getSelectedItems: () => state.selection,
      selectItem: async (id) => {
        state.selectedIDs.push(id);
      },
    };
    Object.assign(win.document, {
      createXULElement: (name: string) => win.document.createElement(name),
    });
    win.document.body.innerHTML =
      '<menupopup id="zotero-itemmenu"><menuitem id="native-entry"></menuitem></menupopup>';
    menus.registerItemContextMenu(win);
    return { win, state };
  }
  t.after(() => {
    menus.unregisterMenus();
    for (const win of windows) win.close();
  });
  return {
    ...menus,
    makeWindow,
    items,
    calls,
    exports,
    opened,
    libraries,
    setPending: (value?: Promise<Item>) => {
      pending = value;
    },
  };
}
function entry(win: Host, name: string) {
  const result = win.document.getElementById(`bamboo-item-${name}`);
  assert.ok(result);
  return result;
}
function show(win: Host) {
  win.document
    .getElementById("zotero-itemmenu")!
    .dispatchEvent(new win.Event("popupshowing", { bubbles: true }));
}
async function command(win: Host, name: string) {
  entry(win, name).dispatchEvent(new win.Event("command", { bubbles: true }));
  await setImmediate();
  await setImmediate();
}
function visibleCommands(win: Host) {
  return [...entry(win, "scholar-sketch").querySelectorAll("menuitem")]
    .filter((element) => !element.hidden)
    .map((element) => element.id);
}

test("regular items expose both child creation commands and export only their direct Markdown attachments", async (t) => {
  const f = fixture(t);
  const { win, state } = f.makeWindow();
  const parent = makeItem(1, { children: [11, 12, 13, 14, 15, 16] });
  const direct = makeItem(11, { parent: 1, kind: "md" });
  for (const item of [
    direct,
    makeItem(12, { parent: 1, kind: "pdf" }),
    makeItem(13, { parent: 99, kind: "md" }),
    makeItem(14, { parent: 1, kind: "md", deleted: true }),
    makeItem(15, { parent: 1, kind: "md", libraryID: 2 }),
  ])
    f.items.set(item.id, item);
  state.selection = [parent];
  show(win);
  assert.deepEqual(visibleCommands(win), [
    "bamboo-item-create-canvas",
    "bamboo-item-create-md",
    "bamboo-item-export-md",
  ]);
  assert.equal(entry(win, "export-md").hasAttribute("disabled"), false);
  await command(win, "create-md");
  await command(win, "create-canvas");
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ["markdown", "whiteboard"],
  );
  for (const call of f.calls) {
    assert.equal(call.parent, parent);
    assert.equal(call.options.win, win);
  }
  assert.equal(f.calls[0].options.requireParent, true);
  assert.deepEqual(
    f.opened.map((call) => call.win),
    [win, win],
  );
  assert.equal(state.selectedIDs.length, 2);
  await command(win, "export-md");
  assert.equal(f.exports.length, 1);
  assert.deepEqual(Array.from(f.exports[0].items), [direct]);
  assert.equal(f.exports[0].win, win);
  state.selection = [makeItem(2)];
  show(win);
  assert.equal(entry(win, "export-md").getAttribute("disabled"), "true");
  await command(win, "export-md");
  assert.equal(f.exports.length, 1);
});

test("Markdown attachments show only export inside the submenu and mixed selections hide it", async (t) => {
  const f = fixture(t);
  const { win, state } = f.makeWindow();
  const note = makeItem(11, { kind: "md" });
  state.selection = [note];
  show(win);
  assert.deepEqual(visibleCommands(win), ["bamboo-item-export-md"]);
  assert.equal(win.document.getElementById("bamboo-item-open-md"), null);
  assert.equal(entry(win, "open-md-window").hidden, false);
  await command(win, "create-md");
  await command(win, "create-canvas");
  assert.equal(f.calls.length, 0);
  await command(win, "export-md");
  assert.deepEqual(Array.from(f.exports[0].items), [note]);
  state.selection = [note, makeItem(12, { kind: "md" })];
  show(win);
  assert.equal(entry(win, "scholar-sketch").hidden, false);
  state.selection.push(makeItem(13, { kind: "pdf" }));
  show(win);
  assert.equal(entry(win, "scholar-sketch").hidden, true);
});

test("pending commands retain each owning window's parent and selection without duplicate creation", async (t) => {
  const f = fixture(t);
  const first = f.makeWindow();
  const second = f.makeWindow();
  const firstParent = makeItem(1);
  const secondParent = makeItem(2, { libraryID: 2 });
  first.state.selection = [firstParent];
  second.state.selection = [secondParent];
  let resolve!: (item: Item) => void;
  f.setPending(
    new Promise<Item>((done) => {
      resolve = done;
    }),
  );
  await command(first.win, "create-md");
  first.state.selection = [makeItem(3)];
  await command(first.win, "create-canvas");
  f.setPending();
  await command(second.win, "create-canvas");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].parent, firstParent);
  assert.equal(f.calls[1].parent, secondParent);
  resolve(makeItem(20, { kind: "md", parent: 1 }));
  await setImmediate();
  await setImmediate();
  assert.deepEqual(first.state.selectedIDs, [20]);
  assert.equal(f.opened.at(-1)?.win, first.win);
  const notes = [
    makeItem(31, { kind: "md" }),
    makeItem(32, { kind: "md", libraryID: 2 }),
  ];
  first.state.selection = [notes[0]];
  second.state.selection = [notes[1]];
  await command(first.win, "export-md");
  await command(second.win, "export-md");
  assert.equal(f.exports[0].win, first.win);
  assert.equal(f.exports[0].items[0], notes[0]);
  assert.equal(f.exports[1].win, second.win);
  assert.equal(f.exports[1].items[0], notes[1]);
});

test("read-only parents reject creation and unregister removes submenu listeners", async (t) => {
  const f = fixture(t);
  const { win, state } = f.makeWindow();
  state.selection = [makeItem(1, { editable: false })];
  show(win);
  assert.equal(entry(win, "create-md").getAttribute("disabled"), "true");
  await command(win, "create-md");
  await command(win, "create-canvas");
  assert.equal(f.calls.length, 0);
  state.selection = [makeItem(2)];
  const old = entry(win, "create-md");
  f.registerItemContextMenu(win);
  assert.equal(
    win.document.querySelectorAll("#bamboo-item-scholar-sketch").length,
    1,
  );
  old.dispatchEvent(new win.Event("command"));
  await setImmediate();
  assert.equal(f.calls.length, 0);
  f.unregisterItemContextMenu(win);
  assert.equal(win.document.querySelector("#bamboo-item-scholar-sketch"), null);
  assert.ok(win.document.getElementById("native-entry"));
});
