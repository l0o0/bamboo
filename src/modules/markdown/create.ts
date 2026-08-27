import { getPref } from "../../utils/prefs";
import { resolveMarkdownCollectionID } from "./create-target";
import { defaultMarkdownFilename, markdownDocumentTitle } from "./detect";
import { buildNoteWithFrontmatter } from "./frontmatter";
import { openMarkdownAttachment } from "./open";
import { createMarkdownImportPaths } from "./storage-filename";

/**
 * Create a stored .md attachment under a regular item (or top-level), then open it.
 */
export async function createMarkdownAttachment(
  parentItem?: Zotero.Item | null,
  options: {
    open?: boolean;
    initialContent?: string;
    /** Suppress UI side effects (ProgressWindow, pane selection) for API use. */
    silent?: boolean;
    /** Target library for top-level attachments (defaults to user library). */
    libraryID?: number;
    /** Target collection for top-level attachments (defaults to the selection). */
    collectionID?: number;
  } = {},
): Promise<Zotero.Item | null> {
  const {
    open = true,
    initialContent,
    silent = false,
    libraryID,
    collectionID,
  } = options;

  let parent: Zotero.Item | undefined;
  if (parentItem) {
    if (
      parentItem.isAttachment() ||
      parentItem.isNote() ||
      parentItem.isAnnotation()
    ) {
      parent = parentItem.parentItem || undefined;
    } else if (parentItem.isRegularItem()) {
      parent = parentItem;
    }
  }

  // `getDisplayTitle` may return a Promise in some builds; only use it when
  // it is already a string (it would otherwise end up in the filename).
  const fieldTitle = parent ? String(parent.getField("title") || "") : "";
  const display = parent?.getDisplayTitle?.();
  const displayTitle =
    display && typeof (display as { then?: unknown }).then !== "function"
      ? String(display)
      : "";
  const titleBase = parent ? fieldTitle || displayTitle || "Note" : "Note";
  const filename = defaultMarkdownFilename(String(titleBase));
  const documentTitle = markdownDocumentTitle(filename);

  const useFrontmatter = getPref("frontmatter") !== false;
  const content =
    initialContent ??
    (useFrontmatter
      ? buildNoteWithFrontmatter({
          title: documentTitle,
          parent: parent || null,
        })
      : buildPlainContent(documentTitle, parent));

  const { directory: tmpDirectory, file: tmpPath } = createMarkdownImportPaths(
    Zotero.getTempDirectory().path,
    filename,
  );

  await IOUtils.makeDirectory(tmpDirectory, { ignoreExisting: true });
  await Zotero.File.putContentsAsync(tmpPath, content);

  try {
    const pane = Zotero.getActiveZoteroPane();
    // Standalone attachments need a real libraryID; fall back to user library.
    // Child attachments inherit library from parentItemID (do not pass both
    // parentItemID and collections — Zotero throws).
    const targetLibraryID =
      parent?.libraryID ?? libraryID ?? Zotero.Libraries.userLibraryID;

    const collection = !parent
      ? resolveMarkdownCollectionID(pane, collectionID)
      : undefined;
    const collections = collection == null ? undefined : [collection];

    ztoolkit.log("createMarkdownAttachment import", {
      tmpPath,
      parentItemID: parent?.id,
      libraryID: parent ? undefined : targetLibraryID,
      collections,
    });

    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpPath,
      parentItemID: parent?.id,
      // Only for top-level items; parent path uses parentItemID alone
      libraryID: parent ? undefined : targetLibraryID,
      collections,
      title: filename,
      contentType: "text/markdown",
      charset: "utf-8",
    });

    if (!attachment?.id) {
      throw new Error("importFromFile returned no attachment item");
    }

    if (attachment.attachmentContentType !== "text/markdown") {
      attachment.attachmentContentType = "text/markdown";
      await attachment.saveTx({ skipSelect: true });
    }
    if (attachment.getField("title") !== filename) {
      attachment.setField("title", filename);
      await attachment.saveTx({ skipSelect: true });
    }

    // Select so the item is visible in the library / item list
    if (!silent) {
      try {
        if (pane?.selectItem) {
          await pane.selectItem(attachment.id);
        }
      } catch (e) {
        ztoolkit.log("selectItem after create failed", e);
      }
    }

    if (open) {
      await openMarkdownAttachment(attachment);
    }

    return attachment;
  } catch (e) {
    ztoolkit.log("createMarkdownAttachment failed", e);
    if (!silent) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `Create failed: ${e instanceof Error ? e.message : String(e)}`,
          type: "fail",
        })
        .show();
    }
    return null;
  } finally {
    try {
      if (await IOUtils.exists(tmpDirectory)) {
        await IOUtils.remove(tmpDirectory, { recursive: true });
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

function buildPlainContent(title: string, parent?: Zotero.Item): string {
  const lines = [`# ${title}`, ""];
  if (parent) {
    const creators = parent.getCreators?.() || [];
    if (creators.length) {
      const names = creators
        .map((c: any) =>
          c.lastName
            ? `${c.firstName ? c.firstName + " " : ""}${c.lastName}`
            : c.name || "",
        )
        .filter(Boolean)
        .join(", ");
      if (names) lines.push(`> ${names}`, "");
    }
    const date = parent.getField("date");
    if (date) lines.push(`> ${date}`, "");
  }
  lines.push("", "");
  return lines.join("\n");
}

/**
 * Resolve selected items and create a markdown note for the first eligible parent.
 */
export async function createMarkdownForSelection(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems?.() || [];

  if (!selected.length) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: "Select an item first",
        type: "fail",
      })
      .show();
    return;
  }

  let parent: Zotero.Item | null = null;
  for (const item of selected) {
    if (item.isRegularItem()) {
      parent = item;
      break;
    }
    if (item.isAttachment() || item.isNote()) {
      parent = item.parentItem || null;
      if (parent) break;
    }
  }

  // No regular parent found: still create standalone in current library
  // (toolbar "item md" with only attachments selected used to silently
  // create orphaned top-level items without collection membership).
  await createMarkdownAttachment(parent, { open: true });
}
