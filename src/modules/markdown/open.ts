import { PatchHelper } from "zotero-plugin-toolkit";
import { getPref } from "../../utils/prefs";
import { isMarkdownAttachment } from "./detect";
import { openMarkdownTab } from "./tab";

let fileHandlerPatch: PatchHelper | null = null;

/**
 * Open a markdown attachment in our editor tab.
 */
export async function openMarkdownAttachment(
  item: Zotero.Item,
): Promise<boolean> {
  if (!isMarkdownAttachment(item)) return false;
  const tabID = await openMarkdownTab(item);
  return !!tabID;
}

/**
 * Intercept Zotero.FileHandlers.open so double-click / view attachment
 * on .md files opens Bamboo instead of the system handler.
 */
export function registerFileOpenInterceptor() {
  if (fileHandlerPatch) return;

  fileHandlerPatch = new PatchHelper();
  fileHandlerPatch.setData({
    target: Zotero.FileHandlers,
    funcSign: "open",
    enabled: true,
    patcher: (original) => {
      return async function patchedOpen(
        this: typeof Zotero.FileHandlers,
        item: Zotero.Item,
        params?: any,
      ) {
        try {
          if (getPref("enable") !== false && isMarkdownAttachment(item)) {
            const ok = await openMarkdownAttachment(item);
            if (ok) return true;
          }
        } catch (e) {
          ztoolkit.log("Markdown open interceptor failed, falling back", e);
        }
        return original.apply(this, [item, params] as any);
      } as typeof Zotero.FileHandlers.open;
    },
  });
  fileHandlerPatch.enable();
  ztoolkit.log("Markdown FileHandlers.open interceptor registered");
}

export function unregisterFileOpenInterceptor() {
  fileHandlerPatch?.disable();
  fileHandlerPatch = null;
}
