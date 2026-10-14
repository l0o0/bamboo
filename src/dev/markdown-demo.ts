import { createFakeZotero } from "@zotero-plugin/fake-zotero";
import { createMarkdownEditor } from "../modules/markdown/editor";
import {
  openDocumentLink,
  searchDocumentLinks,
} from "../modules/markdown/document-links";
import {
  clearNoteLibraries,
  invalidateNoteLibrary,
  readLibraryNotes,
} from "../modules/markdown/note-library";
import {
  mountBacklinksSidebar,
  mountNoteBacklinks,
} from "../modules/markdown/backlinks";
import { backlinksSidebarCSS } from "../modules/markdown/styles";
import {
  noteHeadingPosition,
  type PortableNote,
} from "../modules/markdown/note-links";
import { buildNoteExport } from "../modules/markdown/export-notes";
import { persistMarkdownContent } from "../modules/markdown/persist";

const seeds: Record<string, string> = {
  MDNOTE01: `---
title: Research
custom:
  preserve: this YAML
---
# Markdown browser lab

Edit this document in **live preview** or source mode.

## Research

[Demo paper](zotero://select/library/items/PAPER001)

[[Reading--MDNOTE03|Reading]] · [[Research--MDNOTE02|Another Research note]] · [[#Notes|Notes below]]

- [ ] Check an item
- [x] Load the production editor

| Feature | State |
| --- | --- |
| Zotero fixture | Ready |
| Markdown table | Editable |

## Notes

中文输入、双链、粗体、链接与保存测试。
`,
  MDNOTE02: `# Another Research note

Same filename, different Markdown attachment key.

[[Research--MDNOTE01#Notes|Research notes]]

[[Reading--MDNOTE03|Reading]]
`,
  MDNOTE03: `# Reading

## Findings

This note has two incoming links. Click a linked mention to return to its source.

[[Research--MDNOTE01|Research]]

\`[[Not a link]]\`
`,
};
const storageKey = "fake-zotero:markdown:v2";
const filenames: Record<string, string> = {
  MDNOTE01: "zmd-Research.md",
  MDNOTE02: "zmd-Research.md",
  MDNOTE03: "zmd-Reading.md",
};
const fake = createFakeZotero({
  prefs: { "extensions.zotero.bamboo.fontSize": 15 },
  items: [
    {
      id: 1,
      key: "PAPER001",
      itemType: "journalArticle",
      fields: { title: "Demo paper" },
    },
    ...Object.keys(seeds).map((key, index) => ({
      id: index + 2,
      key,
      parentID: 1,
      itemType: "attachment",
      attachmentContentType: "text/markdown",
      fields: { title: key === "MDNOTE03" ? "Reading" : "Research" },
    })),
  ],
});
const restore = fake.install();
const sidebarStyle = document.createElement("style");
sidebarStyle.textContent = backlinksSidebarCSS();
document.head.append(sidebarStyle);
const toolkit = { log: (...args: unknown[]) => fake.Zotero.debug(...args) };
const toolkitBefore = Object.getOwnPropertyDescriptor(globalThis, "ztoolkit");
Object.defineProperty(globalThis, "ztoolkit", {
  configurable: true,
  value: toolkit,
});
const element = (id: string) => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value;
};
const report = (message: string) => {
  element("status").textContent = message;
};
let contents = { ...seeds };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  if (saved && typeof saved === "object") {
    for (const key of Object.keys(seeds))
      if (typeof saved[key] === "string") contents[key] = saved[key];
  }
} catch (error) {
  report(`Could not load saved fixtures: ${String(error)}`);
}

const pathFor = (key: string) => `/fixtures/${key}/${filenames[key]}`;
const keyForPath = (path: string) => {
  const key = Object.keys(seeds).find((key) => pathFor(key) === path);
  if (!key) throw new Error(`No fixture file: ${path}`);
  return key;
};
// Files are an explicit consumer adapter; fake-zotero itself has no filesystem.
Object.assign(fake.Zotero, {
  Attachments: { LINK_MODE_IMPORTED_FILE: 0, LINK_MODE_LINKED_URL: 3 },
  File: {
    getContentsAsync: async (path: string) => contents[keyForPath(path)],
    putContentsAsync: async (path: string, value: string) => {
      const next = { ...contents, [keyForPath(path)]: value };
      localStorage.setItem(storageKey, JSON.stringify(next));
      contents = next;
    },
  },
});
function adaptItems() {
  for (let id = 2; id <= 4; id++) {
    const item = fake.Zotero.Items.get(id);
    if (item)
      Object.assign(item, {
        attachmentFilename: filenames[item.key],
        attachmentLinkMode: 0,
        getFilePathAsync: async () => pathFor(item.key),
        isTrashed: () => false,
        isEditable: () => true,
      });
  }
}
adaptItems();
clearNoteLibraries();
let currentID = 2;
const currentItem = () =>
  fake.Zotero.Items.get(currentID) as unknown as Zotero.Item;
let uiReady = false;
let disposeBacklinks: (() => void) | undefined;
const readyTimer = window.setTimeout(() => {
  if (!uiReady) report("Editor did not respond. Check iframe loading errors.");
}, 8000);
const editor = createMarkdownEditor(element("markdown-host"), {
  pageURL: new URL("/markdown-editor.html", location.href).href,
  channel: "fake-zotero-markdown",
  doc: contents.MDNOTE01,
  win: window,
  onChange() {
    updateStats();
    report("Unsaved changes");
  },
  onOutline(items) {
    if (!uiReady) {
      uiReady = true;
      window.clearTimeout(readyTimer);
      for (const button of document.querySelectorAll<HTMLButtonElement>(
        "header button",
      ))
        button.disabled = false;
      (element("document") as HTMLSelectElement).disabled = false;
      updateStats();
      mountBacklinks();
      report("Production editor ready · three Markdown attachments");
    }
    const outline = element("outline");
    outline.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.textContent = item.text;
      button.style.paddingLeft = `${(item.level - 1) * 12}px`;
      button.onclick = () => editor.revealPosition(item.from);
      outline.appendChild(button);
    }
  },
  onSave: () => {
    void save();
  },
  onLinkSearch: async (query, filter) =>
    (
      await searchDocumentLinks(currentItem(), query, false, {
        filter,
        win: window,
        currentContent: editor.getValue(),
      })
    ).map((candidate) => ({
      ...candidate,
      kindLabel:
        candidate.kindLabel ||
        (candidate.kind === "markdown" ? "Markdown" : candidate.kind),
    })),
  onOpenLink(href) {
    void openDocumentLink(href, {
      currentItem: currentItem(),
      win: window,
      onNavigateNote: navigateNote,
    })
      .then((result) =>
        report(
          result.status === "opened"
            ? "Opened fixture link"
            : `Link: ${result.status}`,
        ),
      )
      .catch((error) => report(String(error)));
  },
  onResolveAsset: async () => ({ error: "No image files in this fixture." }),
});
const disposeBacklinksSidebar = mountBacklinksSidebar(
  element("workspace"),
  element("references"),
  element("backlinks-toggle") as HTMLButtonElement,
  () => editor.view.requestMeasure(),
);
function updateStats() {
  const stats = editor.getStats();
  element("stats").textContent =
    `${stats.chars} characters · ${stats.lines} lines · ${stats.words} words`;
}
async function save() {
  try {
    const item = currentItem();
    const value = await editor.requestSnapshot();
    await persistMarkdownContent(item, value, { syncTitle: true });
    element("saved").textContent = value;
    updateStats();
    report("Markdown saved in this browser.");
    return true;
  } catch (error) {
    report(`Save failed: ${String(error)}`);
    return false;
  }
}
async function navigateNote(
  note: PortableNote,
  heading?: string,
  position?: number,
) {
  const item = fake.Zotero.Items.getByLibraryAndKey(note.libraryID, note.key);
  if (!item) return false;
  if (currentID !== item.id) {
    if (!(await save()))
      throw new Error("Save failed; the current note remains open.");
    currentID = item.id;
    editor.setValue(contents[item.key]);
    (element("document") as HTMLSelectElement).value = String(currentID);
    element("saved").textContent = contents[item.key];
    mountBacklinks();
    updateStats();
  }
  const from =
    position ?? (heading ? noteHeadingPosition(editor.getValue(), heading) : 0);
  if (from === null) throw new Error(`Heading not found: ${heading}`);
  editor.revealPosition(from);
  return true;
}
function mountBacklinks() {
  disposeBacklinks?.();
  disposeBacklinks = mountNoteBacklinks(
    element("references"),
    currentItem(),
    window,
    {
      onNavigateNote: navigateNote,
      fullHeight: true,
      labels: {
        title: "Linked mentions",
        refresh: "Refresh links",
        loading: "Reading saved notes…",
        empty: "No saved notes link here yet.",
        incomplete: "Unreadable notes",
        failed: "Could not open reference",
      },
    },
  );
}
(element("document") as HTMLSelectElement).onchange = () => {
  const requested = Number((element("document") as HTMLSelectElement).value);
  (element("document") as HTMLSelectElement).value = String(currentID);
  const item = fake.Zotero.Items.get(requested);
  if (item)
    void navigateNote({
      libraryID: 1,
      key: item.key,
      title: item.getField("title"),
      filename: filenames[item.key],
    }).catch((error) => report(String(error)));
};
element("source").onclick = () => editor.setMode("source");
element("live").onclick = () => editor.setMode("live");
element("bold").onclick = () => editor.wrapSelection("**");
element("table").onclick = () =>
  editor.insertText("\n| Name | Value |\n| --- | --- |\n| New | Row |\n");
element("undo").onclick = () => editor.command("undo");
element("redo").onclick = () => editor.command("redo");
element("save").onclick = () => {
  void save();
};
element("reload").onclick = () => {
  editor.setValue(contents[currentItem().key]);
  element("saved").textContent = contents[currentItem().key];
  updateStats();
  report("Reloaded saved Markdown.");
};
element("reset").onclick = () => {
  try {
    localStorage.removeItem(storageKey);
    contents = { ...seeds };
    fake.reset();
    adaptItems();
    invalidateNoteLibrary(1);
    editor.setValue(contents[currentItem().key]);
    element("saved").textContent = "";
    updateStats();
    report("All Markdown fixtures reset.");
  } catch (error) {
    report(`Reset failed: ${String(error)}`);
  }
};
for (const format of ["wiki", "markdown"] as const) {
  element(`export-${format}`).onclick = () => {
    void (async () => {
      if (!(await save())) return;
      const plan = buildNoteExport(await readLibraryNotes(1), { format });
      element("export-result").textContent = JSON.stringify(plan, null, 2);
      (element("export-details") as HTMLDetailsElement).open = true;
      report(
        `Export preview: ${plan.files.length} files · ${plan.warnings.length} warnings`,
      );
    })().catch((error) => report(`Export failed: ${String(error)}`));
  };
}
Object.assign(window, {
  __fakeZoteroMarkdown: {
    fake,
    editor,
    get isReady() {
      return uiReady;
    },
  },
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.clearTimeout(readyTimer);
    disposeBacklinks?.();
    disposeBacklinksSidebar();
    sidebarStyle.remove();
    clearNoteLibraries();
    editor.destroy();
    restore();
    if ((globalThis as unknown as { ztoolkit: unknown }).ztoolkit === toolkit) {
      if (toolkitBefore)
        Object.defineProperty(globalThis, "ztoolkit", toolkitBefore);
      else Reflect.deleteProperty(globalThis, "ztoolkit");
    }
    Reflect.deleteProperty(window, "__fakeZoteroMarkdown");
  });
