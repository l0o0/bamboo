import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();
const zoteroGlobal = basicTool.getGlobal("Zotero") as Record<string, any>;

if (!zoteroGlobal[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  zoteroGlobal[config.addonInstance] = addon;
}

// Rebind the sandbox global on reloads where Zotero still has the previous
// addon object. Without this, helpers such as getString cannot reach
// `data.locale` after a development rebuild.
_globalThis.addon = zoteroGlobal[config.addonInstance];

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
