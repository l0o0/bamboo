import {
  getSelectedCollections,
  getSelectedLibraryIDs,
} from "../compat/zotero-pane";
import { getString } from "../utils/locale";
import { createMarkdownAttachment } from "./markdown/create";
import { openMarkdownTab } from "./markdown/tab";
import { createWhiteboardAttachment } from "./whiteboard/create";
import { rememberWhiteboard } from "./whiteboard/open";
import { openWhiteboardTab } from "./whiteboard/tab";
import { isMarkdownAttachment } from "./markdown/detect";
import { exportSelectedNotes } from "./markdown/export-notes";
import { importMarkdownFile } from "./markdown/transfer";

const cleanups = new Map<Window, () => void>();

function creationTarget(win: _ZoteroTypes.MainWindow) {
  const pane = win.ZoteroPane;
  const selected = pane?.getSelectedItems?.() ?? [];
  let parent: Zotero.Item | null = selected.length === 1 ? selected[0] : null;
  while (parent && !parent.isRegularItem()) parent = parent.parentItem || null;
  const libraryID =
    parent?.libraryID ??
    getSelectedLibraryIDs(pane)[0] ??
    Zotero.Libraries.userLibraryID;
  const library = Zotero.Libraries.get(libraryID);
  const collectionID = parent
    ? undefined
    : getSelectedCollections(pane, true).find((id) => {
        if (!Number.isInteger(id) || id <= 0) return false;
        const collection = Zotero.Collections.get(id);
        return (
          collection &&
          collection.libraryID === libraryID &&
          !collection.deleted
        );
      });
  return {
    pane,
    parent,
    libraryID,
    collectionID: collectionID ?? null,
    editable: Boolean(
      pane &&
      library &&
      library.editable &&
      library.filesEditable &&
      !parent?.deleted &&
      (typeof pane.canEdit !== "function" || pane.canEdit()),
    ),
  };
}

/** A native menu button owned by each main window, including secondary windows. */
export function registerCreationToolbar(win: _ZoteroTypes.MainWindow): void {
  unregisterCreationToolbar(win);
  const doc = win.document;
  const toolbar = doc.getElementById("zotero-items-toolbar");
  const anchor = doc.getElementById("zotero-tb-note-add");
  if (!toolbar || anchor?.parentElement !== toolbar) {
    ztoolkit.log(
      "Missing library toolbar; Scholar Sketch creation button not registered",
    );
    return;
  }

  const ref = addon.data.config.addonRef;
  const icons = `chrome://${ref}/content/icons/`;
  const button = doc.createXULElement(
    "toolbarbutton",
  ) as XULToolBarButtonElement;
  button.id = `${ref}-create-document`;
  button.setAttribute("class", "zotero-tb-button");
  button.setAttribute("type", "menu");
  button.setAttribute("wantdropmarker", "true");
  button.setAttribute("tabindex", "-1");
  button.setAttribute("aria-label", getString("toolbar-create-document"));
  button.setAttribute("tooltiptext", getString("toolbar-create-document"));
  button.setAttribute("image", `${icons}scholar-sketch-toolbar.svg`);
  const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = `${ref}-create-document-style`;
  style.textContent = `
    #${button.id} .toolbarbutton-icon {
      width: 20px;
      height: 20px;
      list-style-image: url("${icons}scholar-sketch-toolbar.svg");
    }
    #${button.id} .menu-iconic-icon {
      width: 16px;
      height: 16px;
    }
  `;
  const popup = doc.createXULElement("menupopup") as XUL.MenuPopup;
  const markdown = doc.createXULElement("menuitem") as XUL.MenuItem;
  markdown.id = `${ref}-create-markdown`;
  markdown.setAttribute("label", getString("toolbar-create-markdown"));
  markdown.setAttribute("class", "menuitem-iconic");
  markdown.setAttribute("image", `${icons}attachment-markdown.svg`);
  const whiteboard = doc.createXULElement("menuitem") as XUL.MenuItem;
  whiteboard.id = `${ref}-create-whiteboard`;
  whiteboard.setAttribute("label", getString("menuitem-new-whiteboard"));
  whiteboard.setAttribute("class", "menuitem-iconic");
  whiteboard.setAttribute("image", `${icons}attachment-canvas.svg`);
  const transferSeparator = doc.createXULElement("menuseparator");
  transferSeparator.id = `${ref}-markdown-transfer-separator`;
  const importMarkdown = doc.createXULElement("menuitem") as XUL.MenuItem;
  importMarkdown.id = `${ref}-import-markdown`;
  importMarkdown.setAttribute("label", getString("toolbar-import-markdown"));
  const exportMarkdown = doc.createXULElement("menuitem") as XUL.MenuItem;
  exportMarkdown.id = `${ref}-export-markdown`;
  exportMarkdown.setAttribute("label", getString("toolbar-export-markdown"));
  popup.append(
    markdown,
    whiteboard,
    transferSeparator,
    importMarkdown,
    exportMarkdown,
  );
  button.append(popup);

  let disposed = false;
  let busy = false;
  const refresh = () => {
    let editable = false;
    try {
      editable = !disposed && !busy && creationTarget(win).editable;
    } catch (error) {
      ztoolkit.log("Cannot resolve document creation target", error);
    }
    for (const item of [markdown, whiteboard, importMarkdown]) {
      if (editable) item.removeAttribute("disabled");
      else item.setAttribute("disabled", "true");
    }
    const selected = win.ZoteroPane?.getSelectedItems?.() ?? [];
    if (
      !disposed &&
      !busy &&
      selected.length &&
      selected.every(isMarkdownAttachment)
    )
      exportMarkdown.removeAttribute("disabled");
    else exportMarkdown.setAttribute("disabled", "true");
  };

  const create = async (kind: "markdown" | "whiteboard") => {
    if (disposed || busy || win.closed) return;
    let created = false;
    try {
      // Capture the owning window's target before any asynchronous file work.
      const target = creationTarget(win);
      if (!target.editable) {
        refresh();
        return;
      }
      busy = true;
      refresh();
      const item =
        kind === "markdown"
          ? await createMarkdownAttachment(target.parent, {
              open: false,
              silent: true,
              libraryID: target.libraryID,
              collectionID: target.collectionID,
              win,
            })
          : await createWhiteboardAttachment(target.parent, {
              select: false,
              reportError: false,
              libraryID: target.libraryID,
              collections: target.parent
                ? undefined
                : target.collectionID === null
                  ? []
                  : [target.collectionID],
            });
      if (!item) throw new Error("No attachment was created");
      created = true;
      if (disposed || win.closed) return;
      try {
        await target.pane.selectItem(item.id);
      } catch (error) {
        ztoolkit.log("Selecting the new document failed", error);
      }
      if (disposed || win.closed) return;
      const options = { win, shouldOpen: () => !disposed && !win.closed };
      const tab =
        kind === "markdown"
          ? await openMarkdownTab(item, options)
          : await openWhiteboardTab(item, options);
      if (disposed || win.closed) return;
      if (!tab) throw new Error("The document editor did not open");
      if (kind === "whiteboard") rememberWhiteboard(item.id);
    } catch (error) {
      ztoolkit.log("Scholar Sketch document creation failed", error);
      if (!disposed && !win.closed) {
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({
            text: getString(
              created ? "toolbar-created-open-failed" : "toolbar-create-failed",
            ),
            type: "fail",
          })
          .show();
      }
    } finally {
      busy = false;
      if (!disposed) refresh();
    }
  };
  const onMarkdown = () => void create("markdown");
  const onWhiteboard = () => void create("whiteboard");
  const transfer = async (kind: "import" | "export") => {
    if (disposed || busy || win.closed) return;
    const shouldContinue = () => !disposed && !win.closed;
    try {
      const target = creationTarget(win);
      const selected = [...(win.ZoteroPane?.getSelectedItems?.() ?? [])];
      if (kind === "import" && !target.editable) return;
      if (
        kind === "export" &&
        (!selected.length || !selected.every(isMarkdownAttachment))
      )
        return;
      busy = true;
      refresh();
      if (kind === "import") {
        const item = await importMarkdownFile(win, target, { shouldContinue });
        if (!item || !shouldContinue()) return;
        await target.pane.selectItem(item.id);
        if (!shouldContinue()) return;
        await openMarkdownTab(item, { win, shouldOpen: shouldContinue });
        if (shouldContinue())
          new ztoolkit.ProgressWindow(addon.data.config.addonName)
            .createLine({
              text: getString("markdown-import-complete"),
              type: "success",
            })
            .show();
      } else {
        const result = await exportSelectedNotes(win, selected, "markdown", {
          shouldContinue,
        });
        if (result && shouldContinue())
          new ztoolkit.ProgressWindow(addon.data.config.addonName)
            .createLine({
              text: getString("note-export-complete", {
                args: {
                  count: result.notes,
                  directory: result.directory,
                  warnings: result.warnings.length,
                },
              }),
              type: "success",
            })
            .show();
      }
    } catch (error) {
      ztoolkit.log("Scholar Sketch Markdown transfer failed", error);
      if (shouldContinue())
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({
            text: `${getString("markdown-transfer-failed")}: ${error instanceof Error ? error.message : String(error)}`,
            type: "fail",
          })
          .show();
    } finally {
      busy = false;
      if (!disposed && !win.closed) refresh();
    }
  };
  const onImport = () => void transfer("import");
  const onExport = () => void transfer("export");
  const onShowing = (event: Event) => {
    if (event.target === popup) refresh();
  };

  // Zotero's toolbar arrow navigation is an explicit map of built-in IDs.
  // Extend just the edge beside our button, leaving native menu keys alone.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = Zotero.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const previous = Zotero.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let target: HTMLElement | XULToolBarButtonElement | null = null;
    if (event.target === anchor && event.key === next && !event.shiftKey) {
      target = button;
    } else if (event.target === button && !button.open) {
      if (event.key === previous) target = anchor;
      else if (event.key === "Tab") {
        target = event.shiftKey
          ? anchor
          : doc.getElementById("zotero-tb-search");
      }
    }
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus();
  };
  const onUnload = (event: Event) => {
    if (event.target === win || event.target === doc)
      unregisterCreationToolbar(win);
  };

  markdown.addEventListener("command", onMarkdown);
  whiteboard.addEventListener("command", onWhiteboard);
  importMarkdown.addEventListener("command", onImport);
  exportMarkdown.addEventListener("command", onExport);
  popup.addEventListener("popupshowing", onShowing);
  toolbar.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("unload", onUnload);
  doc.documentElement.append(style);
  anchor.after(button);
  refresh();
  cleanups.set(win, () => {
    disposed = true;
    markdown.removeEventListener("command", onMarkdown);
    whiteboard.removeEventListener("command", onWhiteboard);
    importMarkdown.removeEventListener("command", onImport);
    exportMarkdown.removeEventListener("command", onExport);
    popup.removeEventListener("popupshowing", onShowing);
    toolbar.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("unload", onUnload);
    button.remove();
    style.remove();
  });
}

export function unregisterCreationToolbar(win: Window): void {
  cleanups.get(win)?.();
  cleanups.delete(win);
}

export function unregisterAllCreationToolbars(): void {
  for (const win of cleanups.keys()) unregisterCreationToolbar(win);
}
