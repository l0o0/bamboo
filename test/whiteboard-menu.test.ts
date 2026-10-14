import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  registerWhiteboardMenus,
  unregisterWhiteboardMenus,
} from "../src/modules/whiteboard/menu.ts";

test("Help example menu registers once and is removed on window cleanup", () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<menupopup id="menu_HelpPopup"></menupopup>';
  Object.assign(window.document, {
    createXULElement: window.document.createElement.bind(window.document),
  });
  const globals = globalThis as Record<string, unknown>;
  const previousAddon = globals.addon;
  const previousToolkit = globals.ztoolkit;
  globals.addon = { data: { config: { addonRef: "bamboo" } } };
  globals.ztoolkit = { log: () => {} };
  const win = window as unknown as _ZoteroTypes.MainWindow;
  try {
    registerWhiteboardMenus(win);
    registerWhiteboardMenus(win);
    const items = window.document.querySelectorAll(
      "#menu_HelpPopup > menuitem",
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "bamboo-help-example-whiteboard");
    assert.ok(items[0].getAttribute("label"));
    unregisterWhiteboardMenus(win);
    assert.equal(
      window.document.querySelector("#menu_HelpPopup")?.children.length,
      0,
    );
  } finally {
    unregisterWhiteboardMenus(win);
    if (previousAddon === undefined) delete globals.addon;
    else globals.addon = previousAddon;
    if (previousToolkit === undefined) delete globals.ztoolkit;
    else globals.ztoolkit = previousToolkit;
    window.close();
  }
});

test("standalone window commands are shown only for one matching attachment", async () => {
  const { registerItemContextMenu, unregisterItemContextMenu } =
    await import("../src/modules/markdown/menu.ts");
  const window = new Window();
  window.document.body.innerHTML =
    '<menupopup id="zotero-itemmenu"></menupopup>';
  Object.assign(window.document, {
    createXULElement: window.document.createElement.bind(window.document),
  });
  let selected: unknown[] = [];
  Object.assign(window, { ZoteroPane: { getSelectedItems: () => selected } });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    addon: { data: { config: { addonRef: "bamboo" } } },
    ztoolkit: { log: () => {} },
    Zotero: { Attachments: { LINK_MODE_LINKED_URL: 3 } },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const win = window as unknown as _ZoteroTypes.MainWindow;
  try {
    registerWhiteboardMenus(win);
    registerItemContextMenu(win);
    const popup = window.document.getElementById("zotero-itemmenu")!;
    const md = window.document.getElementById("bamboo-item-open-md-window")!;
    const canvas = window.document.getElementById(
      "bamboo-item-open-canvas-window",
    )!;
    for (const extension of ["md", "canvas", "pdf"]) {
      const item = {
        isAttachment: () => true,
        isEditable: () => true,
        isRegularItem: () => false,
        libraryID: 1,
        attachmentFilename: `file.${extension}`,
        attachmentContentType: extension === "pdf" ? "application/pdf" : "",
      };
      selected = [item];
      popup.dispatchEvent(new window.Event("popupshowing"));
      assert.equal(md.hidden, extension !== "md");
      assert.equal(canvas.hidden, extension !== "canvas");
      selected = [item, item];
      popup.dispatchEvent(new window.Event("popupshowing"));
      assert.equal(md.hidden, true);
      assert.equal(canvas.hidden, true);
    }
    unregisterWhiteboardMenus(win);
    unregisterItemContextMenu(win);
    assert.equal(popup.children.length, 0);
  } finally {
    unregisterWhiteboardMenus(win);
    unregisterItemContextMenu(win);
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  }
});
