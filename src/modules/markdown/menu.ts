import { getString } from "../../utils/locale";
import { createMarkdownForSelection } from "./create";
import { isMarkdownAttachment } from "./detect";
import { openMarkdownAttachment } from "./open";

export function registerMenus() {
  const icon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

  // Create new Markdown under selected item
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${addon.data.config.addonRef}-menuitem-create-md`,
    label: getString("menuitem-create-md"),
    icon,
    commandListener: () => {
      void createMarkdownForSelection();
    },
    getVisibility: () => {
      const pane = Zotero.getActiveZoteroPane();
      const items = pane?.getSelectedItems?.() || [];
      if (!items.length) return false;
      // Hide when only selecting pure annotations without a usable parent
      return items.some(
        (item) =>
          item.isRegularItem() ||
          ((item.isAttachment() || item.isNote()) && !!item.parentItem) ||
          item.isAttachment(),
      );
    },
  });

  // Explicit open for markdown attachments
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${addon.data.config.addonRef}-menuitem-open-md`,
    label: getString("menuitem-open-md"),
    icon,
    commandListener: () => {
      void openSelectedMarkdown();
    },
    getVisibility: () => {
      const pane = Zotero.getActiveZoteroPane();
      const items = pane?.getSelectedItems?.() || [];
      return items.some((item) => isMarkdownAttachment(item));
    },
  });
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
