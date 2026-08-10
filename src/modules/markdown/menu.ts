import { getLocaleID } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { createMarkdownAttachment, createMarkdownForSelection } from "./create";
import { isMarkdownAttachment } from "./detect";
import { openMarkdownAttachment } from "./open";

const registeredMenuIDs: string[] = [];
const icon = () =>
  `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

/**
 * Register item context menus and the toolbar "New Note" popup entries via
 * Zotero.MenuManager (replaces deprecated ztoolkit.Menu in toolkit 5.2+).
 */
export function registerMenus() {
  unregisterMenus();

  const pluginID = addon.data.config.addonID;
  const menuIcon = icon();

  // Item context menu: create / open Markdown
  track(
    Zotero.MenuManager.registerMenu({
      menuID: `${addon.data.config.addonRef}-item-menu`,
      pluginID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: getLocaleID("menuitem-create-md"),
          icon: menuIcon,
          onShowing: (_event, context) => {
            const items = context.items || [];
            const visible = items.some(
              (item) =>
                item.isRegularItem() ||
                ((item.isAttachment() || item.isNote()) && !!item.parentItem) ||
                item.isAttachment(),
            );
            context.setVisible(visible);
          },
          onCommand: () => {
            void createMarkdownForSelection();
          },
        },
        {
          menuType: "menuitem",
          l10nID: getLocaleID("menuitem-open-md"),
          icon: menuIcon,
          onShowing: (_event, context) => {
            const items = context.items || [];
            context.setVisible(
              items.some((item) => isMarkdownAttachment(item)),
            );
          },
          onCommand: () => {
            void openSelectedMarkdown();
          },
        },
      ],
    }),
  );

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
          onCommand: () => {
            void createMarkdownAttachment(null, { open: true });
          },
        },
        {
          menuType: "menuitem",
          l10nID: getLocaleID("menuitem-create-item-md"),
          icon: menuIcon,
          onShowing: (_event, context) => {
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

export function unregisterMenus() {
  for (const id of registeredMenuIDs) {
    try {
      Zotero.MenuManager.unregisterMenu(id);
    } catch (e) {
      ztoolkit.log("unregisterMenu failed", id, e);
    }
  }
  registeredMenuIDs.length = 0;
}

/**
 * Register keyboard shortcut for creating a standalone Markdown note.
 * Prefer calling after createZToolkit() so ztoolkit.Keyboard is the active instance.
 */
export function registerShortcuts() {
  const raw = getPref("shortcutNewStandaloneMd") || "accel,shift,M";

  ztoolkit.Keyboard.register((ev, options) => {
    if (options.type !== "keyup" || !options.keyboard) return;
    if (!options.keyboard.equals(raw)) return;

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
  });
}

function track(id: string | false) {
  if (typeof id === "string" && id) {
    registeredMenuIDs.push(id);
  }
}

async function openSelectedMarkdown() {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane?.getSelectedItems?.() || [];
  for (const item of items) {
    if (isMarkdownAttachment(item)) {
      await openMarkdownAttachment(item);
    }
  }
}
