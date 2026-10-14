import { registerFileHistoryMenu } from "../file-history-ui";
import { getString } from "../../utils/locale";
import {
  getSelectedCollections,
  getSelectedLibraryIDs,
} from "../../compat/zotero-pane";
import { createWhiteboardFromCollection } from "./create";
import { isWhiteboardAttachment } from "./detect";
import { rememberWhiteboard, recentWhiteboardIDs } from "./open";
import { createExampleWhiteboard } from "./tutorial";
import { openWhiteboardTab, openWhiteboardWindow } from "./tab";

const itemCleanups = new Map<Window, () => void>();

function icon() {
  return `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;
}

export function registerWhiteboardMenus(win: _ZoteroTypes.MainWindow) {
  unregisterWhiteboardMenus(win);
  const doc = win.document;
  const itemPopup = doc.querySelector("#zotero-itemmenu") as HTMLElement | null;

  const cleanups: Array<() => void> = [];
  let disposed = false;
  const shouldOpen = () => !disposed && !win.closed;
  const reportError = (error: unknown) => {
    ztoolkit.log("Whiteboard menu command failed", error);
    if (shouldOpen())
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({ text: getString("whiteboard-open-failed"), type: "fail" })
        .show();
  };
  const openCanvas = async (item: Zotero.Item, canOpen = shouldOpen) => {
    if (!canOpen()) return;
    const tabID = await openWhiteboardTab(item, { win, shouldOpen: canOpen });
    if (tabID && canOpen()) rememberWhiteboard(item.id);
  };

  const help = doc.querySelector("#menu_HelpPopup");
  if (help) {
    const example = doc.createXULElement("menuitem") as HTMLElement;
    example.id = `${addon.data.config.addonRef}-help-example-whiteboard`;
    example.setAttribute(
      "label",
      getString("menuitem-create-example-whiteboard"),
    );
    example.setAttribute("class", "menuitem-iconic");
    example.style.listStyleImage = `url(${icon()})`;
    example.addEventListener("command", async () => {
      if (example.getAttribute("disabled") === "true") return;
      example.setAttribute("disabled", "true");
      try {
        await createExampleWhiteboard();
      } catch (error) {
        ztoolkit.log("Create example whiteboard failed", error);
      } finally {
        example.removeAttribute("disabled");
      }
    });
    help.appendChild(example);
    cleanups.push(() => example.remove());
  }

  {
    let creationPopup: HTMLElement | null = null;
    const shouldOpenFromToolbar = () =>
      shouldOpen() && Boolean(creationPopup?.isConnected);
    const separator = doc.createXULElement("menuseparator") as HTMLElement;
    separator.id = `${addon.data.config.addonRef}-toolbar-whiteboard-separator`;
    const fromCollection = doc.createXULElement("menuitem") as HTMLElement;
    fromCollection.id = `${addon.data.config.addonRef}-toolbar-whiteboard-collection`;
    fromCollection.setAttribute(
      "label",
      getString("menuitem-new-whiteboard-from-collection"),
    );
    fromCollection.setAttribute("class", "menuitem-iconic");
    fromCollection.style.listStyleImage = `url(${icon()})`;
    let creatingCollection = false;
    const refreshCollection = () => {
      const pane = win.ZoteroPane;
      const libraryID = getSelectedLibraryIDs(pane)[0];
      const library = libraryID && Zotero.Libraries.get(libraryID);
      const collectionID = getSelectedCollections(pane, true).find((id) => {
        if (!Number.isInteger(id) || id <= 0) return false;
        const collection = Zotero.Collections.get(id);
        return (
          collection &&
          !collection.deleted &&
          collection.libraryID === libraryID
        );
      });
      if (
        shouldOpenFromToolbar() &&
        !creatingCollection &&
        collectionID &&
        library &&
        library.editable &&
        library.filesEditable &&
        (typeof pane?.canEdit !== "function" || pane.canEdit())
      )
        fromCollection.removeAttribute("disabled");
      else fromCollection.setAttribute("disabled", "true");
    };
    const onCollection = () => {
      if (!shouldOpenFromToolbar() || creatingCollection) return;
      refreshCollection();
      if (fromCollection.getAttribute("disabled") === "true") return;
      creatingCollection = true;
      refreshCollection();
      void createWhiteboardFromCollection({
        win,
        shouldOpen: shouldOpenFromToolbar,
      })
        .catch(reportError)
        .finally(() => {
          creatingCollection = false;
          if (shouldOpen()) refreshCollection();
        });
    };
    fromCollection.addEventListener("command", onCollection);

    const recentMenu = doc.createXULElement("menu") as HTMLElement;
    recentMenu.id = `${addon.data.config.addonRef}-toolbar-whiteboard-recent`;
    recentMenu.setAttribute("label", getString("menuitem-recent-whiteboards"));
    recentMenu.setAttribute("class", "menuitem-iconic");
    recentMenu.style.listStyleImage = `url(${icon()})`;
    const recentPopup = doc.createXULElement("menupopup") as HTMLElement;
    recentMenu.appendChild(recentPopup);
    const refreshRecent = (event: Event) => {
      if (event.target !== recentPopup || !shouldOpen()) return;
      while (recentPopup.firstChild) {
        (recentPopup.firstChild as HTMLElement).remove();
      }
      const ids = recentWhiteboardIDs();
      for (const id of ids) {
        const item = Zotero.Items.get(id);
        if (!item || item.deleted || !isWhiteboardAttachment(item)) continue;
        const recentItem = doc.createXULElement("menuitem") as HTMLElement;
        recentItem.setAttribute(
          "label",
          item.attachmentFilename || item.getField("title") || "Whiteboard",
        );
        recentItem.setAttribute("class", "menuitem-iconic");
        recentItem.style.listStyleImage = `url(${icon()})`;
        recentItem.addEventListener("command", () => {
          void openCanvas(item, shouldOpenFromToolbar).catch(reportError);
        });
        recentPopup.appendChild(recentItem);
      }
      if (!recentPopup.firstChild) {
        const empty = doc.createXULElement("menuitem") as HTMLElement;
        empty.setAttribute(
          "label",
          getString("menuitem-recent-whiteboards-empty"),
        );
        empty.setAttribute("disabled", "true");
        recentPopup.appendChild(empty);
      }
    };
    recentPopup.addEventListener("popupshowing", refreshRecent);
    const onCreationShowing = (event: Event) => {
      if (event.target === creationPopup) refreshCollection();
    };
    // Hooks normally create the toolbar first. Watch its host as well so a
    // deferred toolbar or a recreated button retains these secondary commands.
    const observer = new win.MutationObserver(() => attachToToolbar());
    let observedHost: Element | null = null;
    const attachToToolbar = () => {
      if (disposed) return;
      const toolbar = doc.getElementById("zotero-items-toolbar");
      const host = toolbar ?? doc.documentElement;
      if (host !== observedHost) {
        observer.disconnect();
        observer.observe(host, { childList: true, subtree: !toolbar });
        observedHost = host;
      }
      const popup = doc
        .getElementById(`${addon.data.config.addonRef}-create-document`)
        ?.querySelector("menupopup") as HTMLElement | null;
      if (popup === creationPopup) return;
      creationPopup?.removeEventListener("popupshowing", onCreationShowing);
      creationPopup = popup;
      if (!popup) return;
      popup.append(separator, fromCollection, recentMenu);
      popup.addEventListener("popupshowing", onCreationShowing);
      refreshCollection();
    };
    attachToToolbar();
    cleanups.push(() => {
      observer.disconnect();
      creationPopup?.removeEventListener("popupshowing", onCreationShowing);
      fromCollection.removeEventListener("command", onCollection);
      recentPopup.removeEventListener("popupshowing", refreshRecent);
      separator.remove();
      fromCollection.remove();
      recentMenu.remove();
    });
  }

  if (itemPopup) {
    cleanups.push(
      registerFileHistoryMenu(win, itemPopup, isWhiteboardAttachment),
    );
    const openItem = doc.createXULElement("menuitem") as HTMLElement;
    openItem.id = `${addon.data.config.addonRef}-item-open-canvas`;
    openItem.setAttribute("label", getString("menuitem-open-whiteboard"));
    openItem.setAttribute("class", "menuitem-iconic");
    openItem.style.listStyleImage = `url(${icon()})`;
    const windowItem = doc.createXULElement("menuitem") as HTMLElement;
    windowItem.id = `${addon.data.config.addonRef}-item-open-canvas-window`;
    windowItem.setAttribute("label", getString("more-open-window"));
    const onOpenWindow = () => {
      const selected = win.ZoteroPane?.getSelectedItems?.() || [];
      if (selected.length !== 1 || !isWhiteboardAttachment(selected[0])) return;
      void openWhiteboardWindow(selected[0], { win }).catch((error) => {
        ztoolkit.log("Failed to open standalone Canvas window", error);
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({
            text: getString("whiteboard-open-failed"),
            type: "fail",
          })
          .show();
      });
    };
    const onOpen = () => {
      const selected = win.ZoteroPane?.getSelectedItems?.() || [];
      const canvas = selected.find(isWhiteboardAttachment);
      if (canvas) void openCanvas(canvas).catch(reportError);
    };
    const onShowing = () => {
      const selected = win.ZoteroPane?.getSelectedItems?.() || [];
      openItem.hidden = !(
        selected.length === 1 && isWhiteboardAttachment(selected[0])
      );
      windowItem.hidden = openItem.hidden;
    };
    openItem.addEventListener("command", onOpen);
    windowItem.addEventListener("command", onOpenWindow);
    itemPopup.addEventListener("popupshowing", onShowing);
    itemPopup.append(openItem, windowItem);
    cleanups.push(() => {
      itemPopup.removeEventListener("popupshowing", onShowing);
      windowItem.removeEventListener("command", onOpenWindow);
      windowItem.remove();
      openItem.remove();
    });
  }

  itemCleanups.set(win, () => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
  });
}

export function unregisterWhiteboardMenus(win: Window) {
  itemCleanups.get(win)?.();
  itemCleanups.delete(win);
}
