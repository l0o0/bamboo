import { getPref } from "../../utils/prefs";
import { defaultMarkdownFilename } from "./detect";
import { buildNoteWithFrontmatter } from "./frontmatter";
import { openMarkdownAttachment } from "./open";

/**
 * Create a stored .md attachment under a regular item (or top-level), then open it.
 */
export async function createMarkdownAttachment(
  parentItem?: Zotero.Item | null,
  options: { open?: boolean; initialContent?: string } = {},
): Promise<Zotero.Item | null> {
  const { open = true, initialContent } = options;

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

  const titleBase = parent
    ? parent.getField("title") || parent.getDisplayTitle()
    : "Note";
  const filename = defaultMarkdownFilename(String(titleBase));

  const useFrontmatter = getPref("frontmatter") !== false;
  const content =
    initialContent ??
    (useFrontmatter
      ? buildNoteWithFrontmatter({
          title: String(titleBase),
          parent: parent || null,
        })
      : buildPlainContent(String(titleBase), parent));

  const tmpDir = Zotero.getTempDirectory().path;
  const tmpPath = PathUtils.join(
    tmpDir,
    `zotero-markdown-${Date.now()}-${filename}`,
  );

  await Zotero.File.putContentsAsync(tmpPath, content);

  try {
    const pane = Zotero.getActiveZoteroPane();
    // Standalone attachments need a real libraryID; fall back to user library.
    // Child attachments inherit library from parentItemID (do not pass both
    // parentItemID and collections — Zotero throws).
    const libraryID = parent?.libraryID ?? Zotero.Libraries.userLibraryID;

    const selectedIDs = !parent
      ? pane?.getSelectedCollections?.(true)
      : undefined;
    const collection =
      Array.isArray(selectedIDs) && typeof selectedIDs[0] === "number"
        ? selectedIDs[0]
        : undefined;
    const collections =
      typeof collection === "number" && collection > 0
        ? [collection]
        : undefined;

    ztoolkit.log("createMarkdownAttachment import", {
      tmpPath,
      parentItemID: parent?.id,
      libraryID: parent ? undefined : libraryID,
      collections,
    });

    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpPath,
      parentItemID: parent?.id,
      // Only for top-level items; parent path uses parentItemID alone
      libraryID: parent ? undefined : libraryID,
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

    // Select so the item is visible in the library / item list
    try {
      if (pane?.selectItem) {
        await pane.selectItem(attachment.id);
      }
    } catch (e) {
      ztoolkit.log("selectItem after create failed", e);
    }

    if (open) {
      await openMarkdownAttachment(attachment);
    }

    return attachment;
  } catch (e) {
    ztoolkit.log("createMarkdownAttachment failed", e);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Create failed: ${e instanceof Error ? e.message : String(e)}`,
        type: "fail",
      })
      .show();
    return null;
  } finally {
    try {
      if (await IOUtils.exists(tmpPath)) {
        await IOUtils.remove(tmpPath);
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
