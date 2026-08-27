/**
 * Public in-process API for Bamboo.
 *
 * Exposed to other plugins / MCP bridges as the
 * `Zotero.Bamboo.api.markdown` namespace.
 * All methods are async, JSON-friendly, and throw `MarkdownApiError` with a
 * stable `code` on failure.
 *
 * Writes always go through the same persistence path as the editor
 * (`persistMarkdownContent`): file write, image-asset cleanup, item title
 * sync, and Zotero file-sync marking.
 */
import {
  getExtension,
  isMarkdownAttachment,
  isMarkdownFilename,
} from "./detect";
import { createMarkdownAttachment } from "./create";
import { sessionRegistry } from "./session-registry";
import { applyFrontmatterPatch, parseFrontmatter } from "./frontmatter";
import {
  renderMarkdown,
  documentTitle as documentTitleFromSource,
} from "./preview";
import { persistMarkdownContent } from "./persist";
import { closeMarkdownSession, closeMarkdownTab, openMarkdownTab } from "./tab";
import { closeSidebarSessions, findSidebarSessions } from "./sidebar";
import { normalizeMarkdownFilename } from "./modal";
import { storedMarkdownFilename } from "./storage-filename";
import { editorSnapshotChanged } from "./api-guards";
import type { MarkdownEditorHandle } from "./editor";
import type { SaveCoordinator } from "./save-coordinator";

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
   * Overwrite an already-dirty editor buffer. The API still rejects a buffer
   * that changes after this call snapshots it, because that would lose new
   * user input even with `force`.
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

/**
 * All live editor sessions (tabs across windows + sidebar editors) grouped by
 * item id, keeping the first tab session per item.
 */
function liveSessionsByItem(): Map<number, OpenSessionLike> {
  const byItem = new Map<number, OpenSessionLike>();
  for (const session of sessionRegistry.all()) {
    if (!byItem.has(session.itemID)) {
      byItem.set(session.itemID, {
        editor: session.editor ?? null,
        save: session.save,
        dirty: session.save.dirty,
      });
    }
  }
  return byItem;
}

interface OpenSessionLike {
  editor: MarkdownEditorHandle | null;
  save: SaveCoordinator;
  dirty: boolean;
}

async function attachmentInfo(
  item: Zotero.Item,
  withContent = false,
  sessionsByItem = liveSessionsByItem(),
): Promise<MarkdownAttachmentInfo> {
  const path = (await item.getFilePathAsync()) || null;
  const filename = item.attachmentFilename || "";
  const parent = item.parentItem;
  const openSession = sessionsByItem.get(item.id);

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
    title: await displayTitle(item, filename),
    filename,
    extension: getExtension(filename),
    parentItemID: parent?.id ?? null,
    parentTitle: parent ? await displayTitle(parent, "") : null,
    linkMode: linkModeName(item.attachmentLinkMode),
    path,
    modified: item.dateModified || null,
    size,
    frontmatterTitle,
    openInTab: !!openSession,
    dirty: openSession?.save.dirty ?? false,
  };
}

/**
 * Field title with a safe `getDisplayTitle` fallback: some Zotero builds
 * return a Promise from `getDisplayTitle`, which `String()` would render as
 * "[object Promise]".
 */
async function displayTitle(
  item: Zotero.Item,
  fallback: string,
): Promise<string> {
  const field = item.getField("title");
  if (field) return String(field);
  const display = item.getDisplayTitle?.();
  if (
    display &&
    typeof (display as unknown as { then?: unknown }).then === "function"
  ) {
    const resolved = await (display as unknown as Promise<unknown>);
    if (resolved) return String(resolved);
  } else if (display) {
    return String(display);
  }
  return fallback;
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

/** Current content, preferring open editor buffers (tabs, then sidebar). */
async function currentContent(item: Zotero.Item): Promise<string> {
  const session = sessionRegistry.all().find((s) => s.itemID === item.id);
  if (session?.editor) {
    return (
      (await session.editor.requestSnapshot()) ?? session.editor.getValue()
    );
  }
  const sidebar = findSidebarSessions(item.id)[0];
  if (sidebar) {
    return (
      (await sidebar.editor.requestSnapshot()) ?? sidebar.editor.getValue()
    );
  }
  return readContent(item);
}

/** All live editor sessions (tabs across windows + sidebar editors) for an item. */
function liveEditorSessions(
  item: Zotero.Item,
): Array<{ editor: MarkdownEditorHandle; save: SaveCoordinator }> {
  const sessions: Array<{
    editor: MarkdownEditorHandle;
    save: SaveCoordinator;
  }> = [];
  for (const tab of sessionRegistry.all()) {
    if (tab.itemID === item.id && tab.editor) {
      sessions.push({ editor: tab.editor, save: tab.save });
    }
  }
  for (const sidebar of findSidebarSessions(item.id)) {
    sessions.push(sidebar);
  }
  return sessions;
}

async function writeContent(
  item: Zotero.Item,
  content: string,
  opts: Pick<UpdateOptions, "force" | "cleanupImages">,
  observedContent?: string,
): Promise<WriteResult> {
  const sessions = liveEditorSessions(item);
  for (const { save, editor } of sessions) {
    if (
      observedContent !== undefined &&
      editorSnapshotChanged(observedContent, editor.getValue())
    ) {
      throw apiError(
        "WRITE_CONFLICT",
        `Markdown item ${item.id} changed in the editor while the API update was in progress`,
      );
    }
    if (!opts.force) {
      if (save.dirty) {
        throw apiError(
          "WRITE_CONFLICT",
          `Markdown item ${item.id} has unsaved editor changes; pass force: true to overwrite`,
        );
      }
    }
  }
  if (sessions.length) {
    for (const { editor, save } of sessions) {
      editor.setValue(content);
      await save.request({ force: true, cleanupImages: opts.cleanupImages });
    }
  } else {
    await persistMarkdownContent(item, content, {
      cleanupImages: opts.cleanupImages,
      syncTitle: true,
      syncFile: true,
    });
  }
  return {
    savedAt: new Date().toISOString(),
    openInTab: !!sessionRegistry.tabs().find((s) => s.itemID === item.id),
  };
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
  // Resolve session state once instead of scanning the registry per item.
  const sessionsByItem = liveSessionsByItem();
  for (const item of items) {
    if (!isMarkdownAttachment(item)) continue;
    // zotero-types does not expose isTrashed; the runtime API does.
    if ((item as unknown as { isTrashed?: () => boolean }).isTrashed?.()) {
      continue;
    }
    const info = await attachmentInfo(item, false, sessionsByItem);
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
  // Permission boundary: only files with a Markdown extension may be wrapped
  // as Markdown attachments. Without this check the API would be an
  // arbitrary file-read primitive — `createLinked` + `read` returns the
  // wrapped file's full content to any caller (plugins / MCP bridges).
  if (!isMarkdownFilename(path)) {
    throw apiError("INVALID_ARGUMENT", `Not a Markdown file: ${path}`);
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
  if (content === existing && !options.cleanupImages) {
    const session = sessionRegistry.tabs().find((s) => s.itemID === itemID);
    return { savedAt: new Date().toISOString(), openInTab: !!session };
  }
  return writeContent(item, content, options, existing);
}

async function patchFrontmatter(
  itemID: number,
  patch: FrontmatterPatch,
): Promise<WriteResult & { content: string }> {
  const item = requireMarkdownItem(itemID);
  const existing = await currentContent(item);
  const content = applyFrontmatterPatch(existing, patch);
  const openInTab = !!sessionRegistry.tabs().find((s) => s.itemID === itemID);
  if (content === existing) {
    return { content, savedAt: new Date().toISOString(), openInTab };
  }
  const result = await writeContent(item, content, {}, existing);
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
  // Same sanitization as the in-app rename dialog: strips path separators and
  // other unsafe characters, so the API cannot be used to rename files
  // outside the attachment (e.g. `../evil` for a linked file).
  const newName = normalizeMarkdownFilename(raw);
  // NOTE: renames the underlying file. For linked attachments this renames
  // the file on disk (e.g. inside an Obsidian vault).
  const result = await item.renameAttachmentFile(
    storedMarkdownFilename(newName),
    false,
  );
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
  item.setField("title", newName);
  await item.saveTx({ skipSelect: true });
  // Keep open editor sessions' cached paths in sync so the document-info
  // modal and reveal-folder show the new location (autosave resolves the
  // path fresh via getFilePathAsync, so writes are already safe).
  const newPath = (await item.getFilePathAsync()) || null;
  for (const session of sessionRegistry.all()) {
    if (session.itemID === itemID && newPath) {
      session.path = newPath;
      session.updateTitle();
    }
  }
  return attachmentInfo(item);
}

async function trash(itemID: number): Promise<{ trashed: boolean }> {
  requireMarkdownItem(itemID);
  // Close open editor sessions first: a live session would otherwise keep
  // autosaving into the trashed attachment's file, "resurrecting" it and
  // re-marking it for Zotero file sync.
  const open = sessionRegistry.all().filter((s) => s.itemID === itemID);
  await Promise.all(
    open.map((s) =>
      closeMarkdownSession(s.tabID, { flush: true }).catch((error) => {
        ztoolkit.log(
          `Failed to close markdown tab ${s.tabID} before trash`,
          error,
        );
      }),
    ),
  );
  await closeSidebarSessions(itemID);
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
  return sessionRegistry.tabs().map((s) => {
    let title: string | null = null;
    try {
      const item = Zotero.Items.get(s.itemID);
      if (item) {
        const field = item.getField("title");
        const display = item.getDisplayTitle?.();
        // `getDisplayTitle` may return a Promise in some builds; sessions()
        // is synchronous, so only use already-resolved string values.
        title = String(
          field ||
            (display &&
            typeof (display as { then?: unknown }).then !== "function"
              ? display
              : "") ||
            "",
        );
      }
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
  // One session failing must not prevent the others from saving.
  const results = await Promise.allSettled(
    targets.map((s) => s.save.request({ force: true })),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  for (const failure of failures) {
    ztoolkit.log("markdown.flush session failed", failure.reason);
  }
  return targets.length - failures.length;
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
