import { showAnnotationExport } from "./annotations";
import { registerFileHistoryMenu } from "../file-history-ui";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { createMarkdownAttachment, createMarkdownForSelection } from "./create";
import { isMarkdownAttachment } from "./detect";
import { openMarkdownAttachment } from "./open";
import { resolveConfiguredShortcut } from "./shortcut";
import { openMarkdownWindow } from "./window";

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

  const openItem = doc.createXULElement("menuitem") as HTMLElement;
  openItem.id = `${addon.data.config.addonRef}-item-open-md`;
  openItem.setAttribute("label", getString("menuitem-open-md"));
  openItem.setAttribute("class", "menuitem-iconic");
  openItem.style.listStyleImage = `url(${icon()})`;

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

  const onCreate = () => void createMarkdownForSelection();
  const onOpen = () => void openSelectedMarkdown(win);
  const onShowing = () => {
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
    createItem.hidden = !one || isMarkdown;
    openItem.hidden = !isMarkdown;
    windowItem.hidden = !isMarkdown;
  };

  createItem.addEventListener("command", onCreate);
  openItem.addEventListener("command", onOpen);
  windowItem.addEventListener("command", onOpenWindow);
  popup.addEventListener("popupshowing", onShowing);
  popup.append(createItem, openItem, windowItem);

  itemMenuCleanups.set(win, () => {
    removeHistoryMenu();
    annotationsItem.remove();
    popup.removeEventListener("popupshowing", onShowing);
    createItem.removeEventListener("command", onCreate);
    openItem.removeEventListener("command", onOpen);
    createItem.remove();
    openItem.remove();
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

async function openSelectedMarkdown(win?: _ZoteroTypes.MainWindow) {
  const pane = win?.ZoteroPane || Zotero.getActiveZoteroPane();
  const items = pane?.getSelectedItems?.() || [];
  for (const item of items) {
    if (isMarkdownAttachment(item)) {
      await openMarkdownAttachment(item);
    }
  }
}
