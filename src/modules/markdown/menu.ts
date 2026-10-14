import { showAnnotationExport } from "./annotations";
import { registerFileHistoryMenu } from "../file-history-ui";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { createMarkdownAttachment } from "./create";
import { isMarkdownAttachment } from "./detect";
import { resolveConfiguredShortcut } from "./shortcut";
import { openMarkdownWindow } from "./window";
import { openMarkdownTab } from "./tab";
import { exportSelectedNotes } from "./export-notes";
import { createWhiteboardAttachment } from "../whiteboard/create";
import { openWhiteboardTab } from "../whiteboard/tab";
import { rememberWhiteboard } from "../whiteboard/open";

const itemMenuCleanups = new Map<Window, () => void>();
let shortcutCallback: ((ev: KeyboardEvent, options: any) => void) | null = null;
const icon = () =>
  `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

/** Register item context commands like Jasminum's legacy toolkit Menu API. */
export function registerItemContextMenu(win: _ZoteroTypes.MainWindow) {
  unregisterItemContextMenu(win);
  const doc = win.document;
  const popup = doc.querySelector("#zotero-itemmenu") as HTMLElement | null;
  if (!popup) {
    ztoolkit.log(
      "Missing #zotero-itemmenu; Markdown context menu not registered",
    );
    return;
  }

  const removeHistoryMenu = registerFileHistoryMenu(
    win,
    popup,
    isMarkdownAttachment,
  );
  const annotationsItem = doc.createXULElement("menuitem") as HTMLElement;
  annotationsItem.setAttribute("label", getString("menuitem-annotations-md"));
  annotationsItem.addEventListener("command", () => {
    const items = win.ZoteroPane?.getSelectedItems?.() || [];
    if (items.length === 1)
      void showAnnotationExport(win, items[0]).catch((error) =>
        win.alert(String(error)),
      );
  });
  popup.append(annotationsItem);
  const createItem = doc.createXULElement("menuitem") as HTMLElement;
  createItem.id = `${addon.data.config.addonRef}-item-create-md`;
  createItem.setAttribute("label", getString("menuitem-create-md"));
  createItem.setAttribute("class", "menuitem-iconic");
  createItem.style.listStyleImage = `url(${icon()})`;

  const windowItem = doc.createXULElement("menuitem") as HTMLElement;
  windowItem.id = `${addon.data.config.addonRef}-item-open-md-window`;
  windowItem.setAttribute("label", getString("more-open-window"));
  const onOpenWindow = () => {
    const selected = win.ZoteroPane?.getSelectedItems?.() || [];
    if (selected.length !== 1 || !isMarkdownAttachment(selected[0])) return;
    void openMarkdownWindow(selected[0], { opener: win }).catch((error) => {
      ztoolkit.log("Failed to open standalone Markdown window", error);
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: getString("error-open-window"), type: "fail" })
        .show();
    });
  };

  let disposed = false;
  let busy = false;
  const shouldContinue = () => !disposed && !win.closed;
  const scholarMenu = doc.createXULElement("menu") as HTMLElement;
  scholarMenu.id = `${addon.data.config.addonRef}-item-scholar-sketch`;
  scholarMenu.setAttribute("label", addon.data.config.addonName);
  scholarMenu.setAttribute("class", "menu-iconic");
  scholarMenu.style.listStyleImage = `url(${icon()})`;
  const scholarPopup = doc.createXULElement("menupopup") as HTMLElement;
  const canvasItem = doc.createXULElement("menuitem") as HTMLElement;
  canvasItem.id = `${addon.data.config.addonRef}-item-create-canvas`;
  canvasItem.setAttribute("label", getString("menuitem-new-whiteboard"));
  const exportItem = doc.createXULElement("menuitem") as HTMLElement;
  exportItem.id = `${addon.data.config.addonRef}-item-export-md`;
  exportItem.setAttribute("label", getString("menuitem-export-selected-md"));
  scholarPopup.append(canvasItem, createItem, exportItem);
  scholarMenu.append(scholarPopup);
  const editableParent = (item: Zotero.Item | undefined) => {
    if (!item?.isRegularItem() || item.deleted || !item.isEditable())
      return false;
    const library = Zotero.Libraries.get(item.libraryID);
    return Boolean(library && library.editable && library.filesEditable);
  };
  const selectedMarkdown = (selected: Zotero.Item[]) => {
    if (selected.length && selected.every(isMarkdownAttachment))
      return selected;
    const parent = selected.length === 1 ? selected[0] : undefined;
    if (!parent?.isRegularItem() || parent.deleted) return [];
    return parent
      .getAttachments()
      .map((id) => Zotero.Items.get(id))
      .filter((item): item is Zotero.Item =>
        Boolean(
          item &&
          !item.deleted &&
          item.libraryID === parent.libraryID &&
          item.parentItemID === parent.id &&
          isMarkdownAttachment(item),
        ),
      );
  };
  const reportError = (error: unknown) => {
    ztoolkit.log("Scholar Sketch item command failed", error);
    if (shouldContinue())
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `${getString("markdown-transfer-failed")}: ${error instanceof Error ? error.message : String(error)}`,
          type: "fail",
        })
        .show();
  };
  const create = async (kind: "markdown" | "whiteboard") => {
    if (!shouldContinue() || busy) return;
    const selected = win.ZoteroPane?.getSelectedItems?.() || [];
    const parent = selected.length === 1 ? selected[0] : undefined;
    if (!editableParent(parent)) return;
    busy = true;
    try {
      const item =
        kind === "markdown"
          ? await createMarkdownAttachment(parent, {
              open: false,
              silent: true,
              win,
              requireParent: true,
              shouldContinue,
            })
          : await createWhiteboardAttachment(parent, {
              select: false,
              reportError: false,
              win,
            });
      if (!item) throw new Error("No attachment was created");
      if (!shouldContinue()) return;
      await win.ZoteroPane.selectItem(item.id);
      if (!shouldContinue()) return;
      const options = { win, shouldOpen: shouldContinue };
      const tab =
        kind === "markdown"
          ? await openMarkdownTab(item, options)
          : await openWhiteboardTab(item, options);
      if (tab && shouldContinue() && kind === "whiteboard")
        rememberWhiteboard(item.id);
    } finally {
      busy = false;
    }
  };
  const onCreate = () => void create("markdown").catch(reportError);
  const onCreateCanvas = () => void create("whiteboard").catch(reportError);
  const onExport = () => {
    if (!shouldContinue() || busy) return;
    const selected = selectedMarkdown([
      ...(win.ZoteroPane?.getSelectedItems?.() || []),
    ]);
    if (!selected.length) return;
    busy = true;
    void exportSelectedNotes(win, selected, "markdown", { shouldContinue })
      .then((result) => {
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
      })
      .catch(reportError)
      .finally(() => {
        busy = false;
      });
  };
  const onShowing = (event?: Event) => {
    if (event && event.target !== popup && event.target !== scholarPopup)
      return;
    const items = win.ZoteroPane?.getSelectedItems?.() || [];
    const one = items.length === 1 ? items[0] : undefined;
    const isMarkdown = !!one && isMarkdownAttachment(one);
    if (one && !one.isEditable())
      annotationsItem.setAttribute("disabled", "true");
    else annotationsItem.removeAttribute("disabled");
    annotationsItem.hidden =
      !one ||
      !(
        one.isRegularItem() ||
        (one.isAttachment() && one.attachmentContentType === "application/pdf")
      );
    const regular = Boolean(one?.isRegularItem());
    const markdownSelection = Boolean(
      items.length && items.every(isMarkdownAttachment),
    );
    scholarMenu.hidden = !regular && !markdownSelection;
    createItem.hidden = !regular;
    canvasItem.hidden = !regular;
    exportItem.hidden = !regular && !markdownSelection;
    for (const item of [createItem, canvasItem]) {
      if (!busy && shouldContinue() && editableParent(one))
        item.removeAttribute("disabled");
      else item.setAttribute("disabled", "true");
    }
    if (busy || !selectedMarkdown(items).length)
      exportItem.setAttribute("disabled", "true");
    else exportItem.removeAttribute("disabled");
    windowItem.hidden = !isMarkdown;
  };

  createItem.addEventListener("command", onCreate);
  canvasItem.addEventListener("command", onCreateCanvas);
  exportItem.addEventListener("command", onExport);
  windowItem.addEventListener("command", onOpenWindow);
  popup.addEventListener("popupshowing", onShowing);
  popup.append(scholarMenu, windowItem);
  onShowing();

  itemMenuCleanups.set(win, () => {
    disposed = true;
    removeHistoryMenu();
    annotationsItem.remove();
    popup.removeEventListener("popupshowing", onShowing);
    createItem.removeEventListener("command", onCreate);
    canvasItem.removeEventListener("command", onCreateCanvas);
    exportItem.removeEventListener("command", onExport);
    createItem.remove();
    scholarMenu.remove();
    windowItem.removeEventListener("command", onOpenWindow);
    windowItem.remove();
  });
}

export function unregisterItemContextMenu(win: Window) {
  itemMenuCleanups.get(win)?.();
  itemMenuCleanups.delete(win);
}

export function unregisterMenus() {
  for (const cleanup of itemMenuCleanups.values()) cleanup();
  itemMenuCleanups.clear();
}

/**
 * Unregister the standalone-markdown keyboard shortcut (idempotent).
 */
export function unregisterShortcuts() {
  if (shortcutCallback) {
    ztoolkit.Keyboard.unregister(shortcutCallback);
    shortcutCallback = null;
  }
}

/**
 * Register keyboard shortcut for creating a standalone Markdown note.
 * Idempotent: safe to call once per main window; re-registration first
 * unregisters the previous callback (KeyboardManager is per-instance).
 */
export function registerShortcuts() {
  const raw = resolveConfiguredShortcut(getPref("shortcutNewStandaloneMd"));

  if (shortcutCallback) {
    ztoolkit.Keyboard.unregister(shortcutCallback);
    shortcutCallback = null;
  }

  shortcutCallback = (ev, options) => {
    if (options.type !== "keyup" || !options.keyboard) return;
    if (!raw || !options.keyboard.equals(raw)) return;

    const target = ev.target as Element | null;
    if (
      target &&
      typeof (target as any).closest === "function" &&
      (target as any).closest(
        "input, textarea, [contenteditable='true'], [contenteditable=true]",
      )
    ) {
      return;
    }

    // Skip when a non-library tab might be editing
    void createMarkdownAttachment(null, { open: true });
  };

  ztoolkit.Keyboard.register(shortcutCallback);
}
