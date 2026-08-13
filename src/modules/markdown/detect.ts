/** Extensions treated as Markdown. */
const MD_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);

/**
 * Whether an item is a file attachment that should open in Zotero Markdown.
 */
export function isMarkdownAttachment(
  item: Zotero.Item | false | undefined,
): item is Zotero.Item {
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

export function defaultMarkdownFilename(
  title?: string,
  now: Date = new Date(),
): string {
  const raw = (title || "Note").trim() || "Note";
  const safe = Zotero.File.getValidFileName(raw).replace(/\.md$/i, "");
  return buildTimestampedMarkdownFilename(safe || "Note", now);
}

export function buildTimestampedMarkdownFilename(
  title: string,
  now: Date,
): string {
  const base = (title.trim() || "Note")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const timestamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
  ].join("-");
  return `${base || "Note"}-${timestamp}.md`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
