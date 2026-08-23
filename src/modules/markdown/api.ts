/**
 * Public in-process API for Bamboo.
 *
 * Exposed to other plugins / MCP bridges as the legacy-compatible
 * `Zotero.ZoteroMarkdown.api.markdown` namespace.
 * All methods are async, JSON-friendly, and throw `MarkdownApiError` with a
 * stable `code` on failure.
 *
 * Writes always go through the same persistence path as the editor
 * (`persistMarkdownContent`): file write, image-asset cleanup, item title
 * sync, and Zotero file-sync marking.
 */
import { getExtension, isMarkdownAttachment } from "./detect";
import { createMarkdownAttachment } from "./create";
import { sessionRegistry } from "./session-registry";
import { applyFrontmatterPatch, parseFrontmatter } from "./frontmatter";
import {
  renderMarkdown,
  documentTitle as documentTitleFromSource,
} from "./preview";
import { persistMarkdownContent } from "./persist";
import { closeMarkdownTab, openMarkdownTab } from "./tab";

export type MarkdownApiErrorCode =
  | "ITEM_NOT_FOUND"
  | "NOT_MARKDOWN"
  | "WRITE_CONFLICT"
  | "WRITE_FAILED"
  | "INVALID_ARGUMENT"
  | "NOT_OPEN";

export class MarkdownApiError extends Error {
  readonly code: MarkdownApiErrorCode;

  constructor(code: MarkdownApiErrorCode, message: string) {
    super(message);
    this.name = "MarkdownApiError";
    this.code = code;
  }
}

function apiError(
  code: MarkdownApiErrorCode,
  message: string,
): MarkdownApiError {
  return new MarkdownApiError(code, message);
}

export type MarkdownLinkMode =
  "imported" | "imported_url" | "linked" | "linked_url";

export interface MarkdownAttachmentInfo {
  itemID: number;
  key: string;
  libraryID: number;
  title: string;
  filename: string;
  extension: string;
  parentItemID: number | null;
  parentTitle: string | null;
  linkMode: MarkdownLinkMode;
  path: string | null;
  /** ISO date of the Zotero item record. */
  modified: string | null;
  /** Only populated by `stat()` / `read()` (requires reading the file). */
  size: number | null;
  /** Only populated by `stat()` / `read()` (requires reading the file). */
  frontmatterTitle: string | null;
  /** Whether a Markdown editor tab is currently open for this item. */
  openInTab: boolean;
  /** Whether the open editor tab has unsaved changes. */
  dirty: boolean;
}

export interface ListOptions {
  libraryID?: number;
  collectionID?: number;
  parentItemID?: number;
  /** Case-insensitive substring match on title / filename / parent title. */
  q?: string;
}

export interface CreateOptions {
  parentItemID?: number;
  libraryID?: number;
  collectionID?: number;
  filename?: string;
  initialContent?: string;
}

export interface CreateLinkedOptions {
  /** Absolute path of the linked file (must exist). */
  path: string;
  parentItemID?: number;
  libraryID?: number;
  collectionID?: number;
  title?: string;
}

export interface FrontmatterPatch {
  /** Keys to set (null/undefined removes the key). */
  set?: Record<string, unknown>;
  /** Keys to delete. */
  delete?: string[];
}

export interface UpdateOptions {
  /** Full replacement content. Omit to only patch frontmatter. */
  content?: string;
  frontmatter?: FrontmatterPatch;
  /**
   * Overwrite even when an open editor tab has unsaved changes.
   * Without `force`, an open dirty tab rejects the write with
   * `WRITE_CONFLICT`.
   */
  force?: boolean;
  /** Remove embedded image assets no longer referenced. */
  cleanupImages?: boolean;
}

export interface WriteResult {
  savedAt: string;
  /** Whether a Markdown editor tab is open for the item. */
  openInTab: boolean;
}

export interface SessionSummary {
  tabID: string;
  itemID: number;
  mode: string;
  dirty: boolean;
  savedAt: string | null;
  title: string | null;
}

export interface MarkdownApi {
  version: number;

  list(options?: ListOptions): Promise<MarkdownAttachmentInfo[]>;
  stat(itemID: number): Promise<MarkdownAttachmentInfo>;
  read(
    itemID: number,
  ): Promise<{ content: string; meta: MarkdownAttachmentInfo }>;
  create(options?: CreateOptions): Promise<MarkdownAttachmentInfo>;
  createLinked(options: CreateLinkedOptions): Promise<MarkdownAttachmentInfo>;
  update(itemID: number, options?: UpdateOptions): Promise<WriteResult>;
  patchFrontmatter(
    itemID: number,
    patch: FrontmatterPatch,
  ): Promise<WriteResult & { content: string }>;
  rename(
    itemID: number,
    options: { filename: string },
  ): Promise<MarkdownAttachmentInfo>;
  trash(itemID: number): Promise<{ trashed: boolean }>;
  openTab(
    itemID: number,
    options?: { win?: _ZoteroTypes.MainWindow },
  ): Promise<{ tabID: string }>;
  closeTab(tabID: string): Promise<{ closed: boolean }>;
  sessions(): SessionSummary[];
  /** Force-save open sessions (optionally for one item). Returns count. */
  flush(itemID?: number): Promise<number>;
  toHtml(itemID: number): Promise<string>;
  /** Pure markdown-it render. */
  render(source: string): string;
  documentTitle(source: string): string;
}

function requireMarkdownItem(itemID: number): Zotero.Item {
  const item = Zotero.Items.get(itemID);
  if (!item) {
    throw apiError("ITEM_NOT_FOUND", `No item with id ${itemID}`);
  }
  if (!isMarkdownAttachment(item)) {
    throw apiError(
      "NOT_MARKDOWN",
      `Item ${itemID} is not a Markdown attachment`,
    );
  }
  return item;
}

function linkModeName(mode: number): MarkdownLinkMode {
  switch (mode) {
    case Zotero.Attachments.LINK_MODE_IMPORTED_URL:
      return "imported_url";
    case Zotero.Attachments.LINK_MODE_LINKED_FILE:
      return "linked";
    case Zotero.Attachments.LINK_MODE_LINKED_URL:
      return "linked_url";
    default:
      return "imported";
  }
}

async function attachmentInfo(
  item: Zotero.Item,
  withContent = false,
): Promise<MarkdownAttachmentInfo> {
  const path = (await item.getFilePathAsync()) || null;
  const filename = item.attachmentFilename || "";
  const parent = item.parentItem;
  const openSession = sessionRegistry.all().find((s) => s.itemID === item.id);

  let size: number | null = null;
  let frontmatterTitle: string | null = null;
  if (withContent && path) {
    try {
      const content = await readFileText(path);
      const { data } = parseFrontmatter(content);
      frontmatterTitle =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : null;
    } catch {
      // unreadable file — leave fields null
    }
    try {
      size = (await IOUtils.stat(path)).size ?? null;
    } catch {
      size = null;
    }
  }

  return {
    itemID: item.id,
    key: item.key,
    libraryID: item.libraryID,
    title: String(item.getField("title") || item.getDisplayTitle() || filename),
    filename,
    extension: getExtension(filename),
    parentItemID: parent?.id ?? null,
    parentTitle: parent
      ? String(parent.getField("title") || parent.getDisplayTitle() || "")
      : null,
    linkMode: linkModeName(item.attachmentLinkMode),
    path,
    modified: item.dateModified || null,
    size,
    frontmatterTitle,
    openInTab: !!openSession,
    dirty: openSession?.save.dirty ?? false,
  };
}

/** Read a file as text, coercing the loose `getContentsAsync` typing. */
async function readFileText(path: string): Promise<string> {
  const data = await Zotero.File.getContentsAsync(path);
  return typeof data === "string" ? data : String(data ?? "");
}

async function readContent(item: Zotero.Item): Promise<string> {
  const path = (await item.getFilePathAsync()) || null;
  if (!path) {
    throw apiError("WRITE_FAILED", "Attachment has no file path");
  }
  return readFileText(path);
}

/** Current content, preferring the open editor buffer when present. */
async function currentContent(item: Zotero.Item): Promise<string> {
  const session = sessionRegistry.all().find((s) => s.itemID === item.id);
  if (session?.editor) {
    return (
      (await session.editor.requestSnapshot()) ?? session.editor.getValue()
    );
  }
  return readContent(item);
}

async function writeContent(
  item: Zotero.Item,
  content: string,
  opts: Pick<UpdateOptions, "force" | "cleanupImages">,
): Promise<WriteResult> {
  const session = sessionRegistry.all().find((s) => s.itemID === item.id);
  if (session?.save.dirty && !opts.force) {
    throw apiError(
      "WRITE_CONFLICT",
      `Markdown item ${item.id} has unsaved editor changes; pass force: true to overwrite`,
    );
  }
  if (session?.editor) {
    session.editor.setValue(content);
    await session.save.request({ force: true });
  } else {
    await persistMarkdownContent(item, content, {
      cleanupImages: opts.cleanupImages,
      syncTitle: true,
      syncFile: true,
    });
  }
  return { savedAt: new Date().toISOString(), openInTab: !!session };
}

/**
 * Merge a frontmatter patch into a Markdown source document.
 * Pure function (unit-testable).
 */
export { applyFrontmatterPatch } from "./frontmatter";

async function list(
  options: ListOptions = {},
): Promise<MarkdownAttachmentInfo[]> {
  const { libraryID, collectionID, parentItemID, q } = options;

  let items: Zotero.Item[];
  if (collectionID != null) {
    const collection = Zotero.Collections.get(collectionID);
    items = collection ? collection.getChildItems() : [];
  } else {
    items = await Zotero.Items.getAll(
      libraryID ?? Zotero.Libraries.userLibraryID,
    );
  }
  if (parentItemID != null) {
    items = items.filter((i) => i.parentItemID === parentItemID);
  }

  const query = (q ?? "").trim().toLowerCase();
  const results: MarkdownAttachmentInfo[] = [];
  for (const item of items) {
    if (!isMarkdownAttachment(item)) continue;
    const info = await attachmentInfo(item);
    if (query) {
      const hay =
        `${info.title} ${info.filename} ${info.parentTitle ?? ""}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    results.push(info);
  }
  results.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  return results;
}

async function stat(itemID: number): Promise<MarkdownAttachmentInfo> {
  const item = requireMarkdownItem(itemID);
  return attachmentInfo(item, true);
}

async function read(
  itemID: number,
): Promise<{ content: string; meta: MarkdownAttachmentInfo }> {
  const item = requireMarkdownItem(itemID);
  const content = await currentContent(item);
  const meta = await attachmentInfo(item, true);
  return { content, meta };
}

async function create(
  options: CreateOptions = {},
): Promise<MarkdownAttachmentInfo> {
  const parent =
    options.parentItemID != null
      ? Zotero.Items.get(options.parentItemID) || null
      : null;
  if (options.parentItemID != null && !parent) {
    throw apiError("ITEM_NOT_FOUND", `No item with id ${options.parentItemID}`);
  }
  const item = await createMarkdownAttachment(parent, {
    open: false,
    silent: true,
    initialContent: options.initialContent,
    libraryID: options.libraryID,
    collectionID: options.collectionID,
  });
  if (!item) {
    throw apiError("WRITE_FAILED", "Failed to create Markdown attachment");
  }
  return attachmentInfo(item);
}

async function createLinked(
  options: CreateLinkedOptions,
): Promise<MarkdownAttachmentInfo> {
  const { path, parentItemID, libraryID, collectionID, title } = options;
  if (!path) {
    throw apiError("INVALID_ARGUMENT", "path is required");
  }
  let exists = false;
  try {
    exists = await IOUtils.exists(path);
  } catch {
    // treat as missing
  }
  if (!exists) {
    throw apiError("INVALID_ARGUMENT", `File not found: ${path}`);
  }
  if (parentItemID != null && !Zotero.Items.get(parentItemID)) {
    throw apiError("ITEM_NOT_FOUND", `No item with id ${parentItemID}`);
  }

  const attachment = await Zotero.Attachments.linkFromFile({
    file: path,
    parentItemID: parentItemID ?? undefined,
    title: title || path.split(/[\\/]/).pop() || "Note",
    collections: collectionID != null ? [collectionID] : undefined,
    // libraryID is read at runtime though not in the typed OptionsFromFile
    ...(libraryID != null ? { libraryID } : {}),
  } as unknown as Parameters<typeof Zotero.Attachments.linkFromFile>[0]);

  if (attachment.attachmentContentType !== "text/markdown") {
    attachment.attachmentContentType = "text/markdown";
    await attachment.saveTx({ skipSelect: true });
  }
  return attachmentInfo(attachment);
}

async function update(
  itemID: number,
  options: UpdateOptions = {},
): Promise<WriteResult> {
  const item = requireMarkdownItem(itemID);
  const existing = await currentContent(item);
  let content = options.content ?? existing;
  if (options.frontmatter) {
    content = applyFrontmatterPatch(content, options.frontmatter);
  }
  if (content === existing) {
    const session = sessionRegistry.all().find((s) => s.itemID === itemID);
    return { savedAt: new Date().toISOString(), openInTab: !!session };
  }
  return writeContent(item, content, options);
}

async function patchFrontmatter(
  itemID: number,
  patch: FrontmatterPatch,
): Promise<WriteResult & { content: string }> {
  const item = requireMarkdownItem(itemID);
  const existing = await currentContent(item);
  const content = applyFrontmatterPatch(existing, patch);
  if (content === existing) {
    return { content, savedAt: new Date().toISOString(), openInTab: false };
  }
  const result = await writeContent(item, content, {});
  return { ...result, content };
}

async function rename(
  itemID: number,
  options: { filename: string },
): Promise<MarkdownAttachmentInfo> {
  const item = requireMarkdownItem(itemID);
  const raw = (options.filename || "").trim();
  if (!raw) {
    throw apiError("INVALID_ARGUMENT", "filename is required");
  }
  const newName = /\.md$/i.test(raw) ? raw : `${raw}.md`;
  // NOTE: renames the underlying file. For linked attachments this renames
  // the file on disk (e.g. inside an Obsidian vault).
  const result = await item.renameAttachmentFile(newName, false);
  if (result === false) {
    throw apiError("ITEM_NOT_FOUND", "Attachment file not found");
  }
  if (result === -1) {
    throw apiError(
      "WRITE_FAILED",
      `Destination file already exists: ${newName}`,
    );
  }
  if (result === -2) {
    throw apiError("WRITE_FAILED", "Failed to rename attachment");
  }
  return attachmentInfo(item);
}

async function trash(itemID: number): Promise<{ trashed: boolean }> {
  requireMarkdownItem(itemID);
  await Zotero.Items.trash(itemID);
  return { trashed: true };
}

async function openTab(
  itemID: number,
  options: { win?: _ZoteroTypes.MainWindow } = {},
): Promise<{ tabID: string }> {
  const item = requireMarkdownItem(itemID);
  const win =
    options.win ??
    (Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined);
  if (!win) {
    throw apiError("NOT_OPEN", "No Zotero main window available");
  }
  const tabID = await openMarkdownTab(item, { win });
  if (!tabID) {
    throw apiError("NOT_OPEN", "Failed to open Markdown tab");
  }
  return { tabID };
}

async function closeTab(tabID: string): Promise<{ closed: boolean }> {
  const closed = await closeMarkdownTab(tabID);
  if (!closed) {
    throw apiError("NOT_OPEN", `No open Markdown tab: ${tabID}`);
  }
  return { closed: true };
}

function sessions(): SessionSummary[] {
  return sessionRegistry.all().map((s) => {
    let title: string | null = null;
    try {
      const item = Zotero.Items.get(s.itemID);
      title = item
        ? String(item.getField("title") || item.getDisplayTitle() || "")
        : null;
    } catch {
      // keep null
    }
    return {
      tabID: s.tabID,
      itemID: s.itemID,
      mode: s.mode,
      dirty: s.save.dirty,
      savedAt: s.savedAt?.toISOString() ?? null,
      title,
    };
  });
}

async function flush(itemID?: number): Promise<number> {
  const targets =
    itemID != null
      ? sessionRegistry.all().filter((s) => s.itemID === itemID)
      : sessionRegistry.all();
  if (targets.length === 0) return 0;
  await Promise.all(targets.map((s) => s.save.request({ force: true })));
  return targets.length;
}

async function toHtml(itemID: number): Promise<string> {
  const item = requireMarkdownItem(itemID);
  return renderMarkdown(await currentContent(item));
}

function render(source: string): string {
  return renderMarkdown(source);
}

function documentTitle(source: string): string {
  return documentTitleFromSource(source);
}

export const markdownApi: MarkdownApi = {
  version: 2,
  list,
  stat,
  read,
  create,
  createLinked,
  update,
  patchFrontmatter,
  rename,
  trash,
  openTab,
  closeTab,
  sessions,
  flush,
  toHtml,
  render,
  documentTitle,
};
