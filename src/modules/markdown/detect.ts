/** Extensions treated as Markdown. */
const MD_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);

/**
 * Whether an item is a file attachment that should open in Zotero Markdown.
 */
export function isMarkdownAttachment(item: Zotero.Item | false | undefined): item is Zotero.Item {
  if (!item || !item.isAttachment()) return false;
  if (item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL) {
    return false;
  }

  const filename = item.attachmentFilename || "";
  const ext = getExtension(filename);
  if (ext && MD_EXTENSIONS.has(ext)) return true;

  const contentType = (item.attachmentContentType || "").toLowerCase();
  return contentType === "text/markdown" || contentType === "text/x-markdown";
}

export function getExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx + 1).toLowerCase();
}

export function defaultMarkdownFilename(title?: string): string {
  const raw = (title || "note").trim() || "note";
  const safe = Zotero.File.getValidFileName(raw).replace(/\.md$/i, "");
  return `${safe || "note"}.md`;
}
