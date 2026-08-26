import { getLocaleID, getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { createMarkdownAttachment, createMarkdownForSelection } from "./create";
import { isMarkdownAttachment } from "./detect";
import { openMarkdownAttachment } from "./open";
import { resolveConfiguredShortcut } from "./shortcut";

const registeredMenuIDs: string[] = [];
const itemMenuCleanups = new Map<Window, () => void>();
let shortcutCallback: ((ev: KeyboardEvent, options: any) => void) | null = null;
const icon = () =>
  `chrome://${addon.data.config.addonRef}/content/icons/favicon.svg`;

/**
 * Register item context menus and the toolbar "New Note" popup entries via
 * Zotero.MenuManager (replaces deprecated ztoolkit.Menu in toolkit 5.2+).
 */
export function registerMenus() {
  unregisterMenus();

  const pluginID = addon.data.config.addonID;
  const menuIcon = icon();

  // Toolbar #zotero-tb-note-add popup: standalone + child markdown notes
  track(
    Zotero.MenuManager.registerMenu({
      menuID: `${addon.data.config.addonRef}-add-note-menu`,
      pluginID,
      target: "main/library/addNote",
      menus: [
        {
          menuType: "separator",
        },
        {
          menuType: "menuitem",
          l10nID: getLocaleID("menuitem-create-standalone-md"),
          icon: menuIcon,
          onShowing: (_event, context) => {
            setMenuLabel(context, "menuitem-create-standalone-md");
          },
          onCommand: () => {
            void createMarkdownAttachment(null, { open: true });
          },
        },
        {
          menuType: "menuitem",
          l10nID: getLocaleID("menuitem-create-item-md"),
          icon: menuIcon,
          onShowing: (_event, context) => {
            setMenuLabel(context, "menuitem-create-item-md");
            const items = context.items || [];
            const one =
              items.length === 1 &&
              (items[0].isRegularItem() || !items[0].isTopLevelItem());
            context.setEnabled(one);
          },
          onCommand: () => {
            void createMarkdownForSelection();
          },
        },
      ],
    }),
  );
}

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

  const onCreate = () => void createMarkdownForSelection();
  const onOpen = () => void openSelectedMarkdown(win);
  const onShowing = () => {
    const items = win.ZoteroPane?.getSelectedItems?.() || [];
    const one = items.length === 1 ? items[0] : undefined;
    const isMarkdown = !!one && isMarkdownAttachment(one);
    createItem.hidden = !one || isMarkdown;
    openItem.hidden = !isMarkdown;
  };

  createItem.addEventListener("command", onCreate);
  openItem.addEventListener("command", onOpen);
  popup.addEventListener("popupshowing", onShowing);
  popup.append(createItem, openItem);

  itemMenuCleanups.set(win, () => {
    popup.removeEventListener("popupshowing", onShowing);
    createItem.removeEventListener("command", onCreate);
    openItem.removeEventListener("command", onOpen);
    createItem.remove();
    openItem.remove();
  });
}

export function unregisterItemContextMenu(win: Window) {
  itemMenuCleanups.get(win)?.();
  itemMenuCleanups.delete(win);
}

/**
 * MenuManager only accepts Fluent IDs. Some Zotero builds do not resolve an
 * add-on's FTL resource for dynamically registered menus, leaving a blank
 * selectable item. Set the XUL label during popup construction as a fallback.
 */
function setMenuLabel(
  context: { menuElem?: Element },
  id:
    | "menuitem-create-md"
    | "menuitem-open-md"
    | "menuitem-create-standalone-md"
    | "menuitem-create-item-md",
) {
  const label = getString(id);
  const menuElem = context.menuElem;
  if (menuElem && label) {
    menuElem.setAttribute("label", label);
  }
}

export function unregisterMenus() {
  for (const id of registeredMenuIDs) {
    try {
      Zotero.MenuManager.unregisterMenu(id);
    } catch (e) {
      ztoolkit.log("unregisterMenu failed", id, e);
    }
  }
  registeredMenuIDs.length = 0;
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

function track(id: string | false) {
  if (typeof id === "string" && id) {
    registeredMenuIDs.push(id);
  }
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
