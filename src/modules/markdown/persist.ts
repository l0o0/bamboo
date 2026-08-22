import { extractFirstHeadingTitle } from "./frontmatter";
import { markdownAttachmentTitle } from "./detect";
import { cleanupUnusedImageAssets } from "./images/service";

/**
 * Single write path for Markdown attachment content.
 *
 * Both the editor (tab.ts `persistSession`) and the public API
 * (`api.ts` `markdown.update`) persist through here, so every write gets the
 * same treatment: file write, optional image-asset cleanup, optional item
 * title sync from the first H1, and optional Zotero file-sync marking.
 *
 * TODO: unify `persistSession` in tab.ts onto this function (kept separate
 * for now to avoid changing the editor save path without in-Zotero testing).
 */
export async function persistMarkdownContent(
  item: Zotero.Item,
  value: string,
  opts: {
    /** Known file path (skips `getFilePathAsync`). */
    path?: string;
    /** Remove embedded image assets that are no longer referenced. */
    cleanupImages?: boolean;
    /** Sync the Zotero item title from the first H1 (editor behavior). */
    syncTitle?: boolean;
    /**
     * Mark stored attachments for Zotero file sync (`to_upload`) so external
     * writes propagate to other devices.
     */
    syncFile?: boolean;
  } = {},
): Promise<{ path: string; titleChanged: boolean }> {
  const path = opts.path ?? ((await item.getFilePathAsync()) || null);
  if (!path) {
    throw new Error("Attachment has no file path");
  }

  await Zotero.File.putContentsAsync(path, value);

  if (opts.cleanupImages) {
    try {
      await cleanupUnusedImageAssets(item, value);
    } catch (error) {
      ztoolkit.log("Failed to clean markdown image assets after save", error);
    }
  }

  let titleChanged = false;
  if (opts.syncTitle) {
    const headingTitle = extractFirstHeadingTitle(value);
    if (headingTitle && item.getField("title") !== headingTitle) {
      titleChanged = true;
      item.setField("title", markdownAttachmentTitle(headingTitle));
      await item.saveTx({ skipSelect: true });
    }
  }

  if (
    opts.syncFile &&
    item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
  ) {
    try {
      if (item.attachmentSyncState !== "to_upload") {
        item.attachmentSyncState = "to_upload";
        await item.saveTx({ skipSelect: true });
      }
    } catch (error) {
      ztoolkit.log("Failed to mark attachment for sync", error);
    }
  }

  return { path, titleChanged };
}
