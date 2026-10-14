import { noteIndex } from "./note-index";
import {
  extractNoteLinks,
  formatNoteLink,
  resolveNoteLink,
} from "./note-links";
import { isMarkdownAttachment } from "./detect";
import type { NoteDocument, PortableNote } from "./note-links";

type NoteListener = (libraryID: number) => void;

export interface NoteReadFailure {
  key: string;
  title: string;
  reason: "not-downloaded" | "unavailable" | "read-error" | "index-error";
  stage: "path" | "stat" | "read" | "parse";
}

interface IndexedNoteDocument extends NoteDocument {
  readFailure?: NoteReadFailure;
}

interface LibraryCache {
  notes: Map<string, IndexedNoteDocument>;
  groupID: number | undefined | null;
  generation: number;
  loaded: boolean;
  pending?: Promise<IndexedNoteDocument[]>;
  indexPending?: Promise<boolean>;
  indexedGeneration?: number;
}

const libraries = new Map<number, LibraryCache>();
const listeners = new Set<NoteListener>();
let observerID: string | undefined;
const windows = new Map<Window, { count: number; onFocus: () => void }>();

const pendingLibraries = new Map<number, Set<string>>();
let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
let backgroundRunning = false;
let lifecycle = 0;

function queueLibraryIndex(libraryID: number, key?: string): void {
  if (!Number.isSafeInteger(libraryID) || libraryID <= 0) return;
  let keys = pendingLibraries.get(libraryID);
  if (!keys) pendingLibraries.set(libraryID, (keys = new Set()));
  if (key) keys.add(key);
  invalidateNoteLibrary(libraryID);
  if (backgroundTimer === undefined && !backgroundRunning)
    backgroundTimer = setTimeout(() => void updateBackgroundIndexes(), 250);
}

async function updateBackgroundIndexes(): Promise<void> {
  backgroundTimer = undefined;
  backgroundRunning = true;
  const epoch = lifecycle;
  try {
    while (pendingLibraries.size && lifecycle === epoch) {
      const [libraryID, changedKeys] = pendingLibraries.entries().next().value!;
      pendingLibraries.delete(libraryID);
      try {
        libraries.delete(libraryID);
        await readLibraryNotes(libraryID, { changedKeys });
        if (lifecycle === epoch) notify(libraryID);
      } catch (error) {
        zotero()?.logError?.(error);
      }
    }
  } finally {
    backgroundRunning = false;
    if (pendingLibraries.size && backgroundTimer === undefined)
      backgroundTimer = setTimeout(() => void updateBackgroundIndexes(), 250);
  }
}

function invalidateLoadedLibraries(): void {
  for (const id of [...libraries.keys()]) queueLibraryIndex(id);
}

/** Notifications enqueue work rather than blocking Zotero's transaction/observer queue. */
export function registerNoteLibraryObserver(): void {
  if (observerID !== undefined) return;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids = [], extraData = {}) {
        if (type === "sync") {
          // Native Runner emits finish/sync, absent from the host's Event union.
          if ((event as string) !== "finish") return;
          // Normal attachment downloads save with skipAll, so no item/file
          // notification follows. Retry only loaded libraries with failures.
          const synced = new Set(ids.map(Number));
          for (const [libraryID, entry] of [...libraries]) {
            if (!entry.loaded || (ids.length && !synced.has(libraryID)))
              continue;
            for (const note of entry.notes.values()) {
              if (!note.readError) continue;
              invalidateNoteLibrary(libraryID);
              break;
            }
          }
          return;
        }
        if (
          !(type === "item" || type === "file") ||
          !["add", "modify", "delete", "trash", "refresh", "move"].includes(
            event,
          )
        )
          return;
        if (!ids.length) {
          invalidateLoadedLibraries();
          return;
        }
        for (const id of ids) {
          try {
            let item: Zotero.Item | undefined;
            try {
              item = Zotero.Items.get(Number(id)) || undefined;
            } catch {
              /* Deleted items may be unavailable. */
            }
            const libraryID = item?.libraryID;
            const attachment = item?.isAttachment();
            const data = (extraData as Record<string, { libraryID?: number }>)[
              String(id)
            ];
            if (item && isMarkdownAttachment(item))
              queueLibraryIndex(item.libraryID, item.key);
            else if (
              libraryID &&
              type === "item" &&
              ((event === "modify" && attachment) || event === "trash")
            ) {
              // Covers renaming Markdown to another extension and trashing a parent item.
              queueLibraryIndex(libraryID);
            } else if (event === "delete") {
              if (data?.libraryID) queueLibraryIndex(data.libraryID);
              else invalidateLoadedLibraries();
            }
          } catch (error) {
            zotero()?.logError?.(error);
          }
        }
      },
    },
    ["item", "file", "sync"],
    "scholarcanvas-note-library",
  );
}

/** External editors do not send Zotero notifications; reread on app return. */
export function bindNoteLibraryWindow(win: Window): () => void {
  let binding = windows.get(win);
  if (!binding) {
    binding = { count: 0, onFocus: invalidateLoadedLibraries };
    windows.set(win, binding);
    win.addEventListener("focus", binding.onFocus);
  }
  binding.count++;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--binding.count === 0) {
      win.removeEventListener("focus", binding.onFocus);
      windows.delete(win);
    }
  };
}

function zotero(): any {
  return (globalThis as { Zotero?: any }).Zotero;
}

function noteTitle(item: Zotero.Item): string {
  const filename = String(item.attachmentFilename || "");
  let title = "";
  try {
    title = String(item.getField("title") || "");
  } catch {
    // Lightweight test wrappers may expose only attachment metadata.
  }
  if (!title) {
    const display = item.getDisplayTitle?.();
    if (
      display &&
      typeof (display as unknown as { then?: unknown }).then !== "function"
    ) {
      title = String(display);
    }
  }
  const value = title || filename || item.key;
  return (
    value
      .trim()
      .replace(/^(?:zmd-)+/i, "")
      .replace(/\.(?:md|markdown|mdown|mkd|mkdn)$/i, "") || "Note"
  );
}

function groupIDForLibrary(libraryID: number): number | undefined | null {
  const api = zotero();
  if (!api || libraryID === api.Libraries?.userLibraryID) return undefined;
  try {
    const library = api.Libraries?.get?.(libraryID);
    if (
      library?.libraryType === "group" &&
      Number.isSafeInteger(library.groupID)
    ) {
      return library.groupID;
    }
    if (library) return null;
  } catch {
    // Try the Groups cache below.
  }
  try {
    const groupID = api.Groups?.getGroupIDFromLibraryID?.(libraryID);
    return Number.isSafeInteger(groupID) && groupID > 0 ? groupID : null;
  } catch {
    return null;
  }
}

/** Metadata only; this function never opens an attachment file. */
export function noteMetadata(item: Zotero.Item): PortableNote | null {
  if (!item || !item.key || typeof (item as any).isAttachment !== "function") {
    return null;
  }
  try {
    if (
      item.deleted ||
      (item as any).isTrashed?.() ||
      !isMarkdownAttachment(item)
    )
      return null;
    // Items.getAll() excludes an attachment's own deleted flag, but includes
    // children of a trashed parent. Native Item has no isTrashed() helper.
    if (item.parentItemID && zotero()?.Items?.get?.(item.parentItemID)?.deleted)
      return null;
  } catch {
    return null;
  }
  const filename = String(item.attachmentFilename || "").trim();
  if (!filename || !Number.isSafeInteger(item.libraryID)) return null;
  const groupID = groupIDForLibrary(item.libraryID);
  if (groupID === null) return null;
  return {
    libraryID: item.libraryID,
    key: String(item.key),
    filename,
    title: noteTitle(item),
    ...(groupID !== undefined ? { groupID } : {}),
  };
}

function asItems(value: unknown): Zotero.Item[] {
  if (!Array.isArray(value)) return value ? [value as Zotero.Item] : [];
  return value as Zotero.Item[];
}

function cachedNotesBelongToLibrary(
  libraryID: number,
  notes: Iterable<PortableNote>,
): boolean {
  const groupID = groupIDForLibrary(libraryID);
  if (groupID === null) return false;
  for (const note of notes) {
    if (
      groupID === undefined
        ? note.groupID !== undefined
        : note.groupID !== groupID
    ) {
      return false;
    }
  }
  return true;
}

async function loadItems(libraryID: number): Promise<Zotero.Item[]> {
  const api = zotero();
  if (!api) return [];
  const all = api.Items?.getAll;
  if (typeof all === "function") {
    try {
      const result = await all.call(api.Items, libraryID);
      const items = asItems(result);
      const filtered = items.filter((item) => item?.libraryID === libraryID);
      if (filtered.length || items.length === 0) return filtered;
    } catch {
      // Search is the portable Zotero fallback.
    }
  }

  const Search = api.Search;
  if (typeof Search !== "function") return [];
  const search = new Search({ libraryID });
  search.addCondition?.("itemType", "is", "attachment");
  const ids = await search.search();
  const values: Zotero.Item[] = [];
  for (
    let offset = 0;
    offset < (Array.isArray(ids) ? ids.length : 0);
    offset += 48
  ) {
    const batch = ids.slice(offset, offset + 48);
    const result = api.Items?.getAsync
      ? await api.Items.getAsync(batch)
      : api.Items?.get?.(batch);
    values.push(...asItems(result));
  }
  return values.filter((item) => item?.libraryID === libraryID);
}

async function fileStamp(
  path: string,
): Promise<{ fileModified: number; fileSize: number } | undefined> {
  if (typeof IOUtils === "undefined") return undefined;
  const stat = await IOUtils.stat(path);
  if (stat.type !== "regular")
    throw new Error("Attachment is not a regular file");
  if (typeof stat.lastModified !== "number" || typeof stat.size !== "number")
    return undefined;
  return { fileModified: stat.lastModified, fileSize: stat.size };
}

async function readDocument(
  item: Zotero.Item,
  metadata: PortableNote,
  previous?: NoteDocument,
): Promise<IndexedNoteDocument> {
  const base = { ...metadata, path: previous?.path };
  let stage: NoteReadFailure["stage"] = "path";
  try {
    const path = (await item.getFilePathAsync()) || undefined;
    if (!path) throw new Error("Attachment has no file path");
    stage = "stat";
    const before = await fileStamp(path);
    if (
      before &&
      previous &&
      !previous.readError &&
      previous.path === path &&
      previous.fileModified === before.fileModified &&
      previous.fileSize === before.fileSize
    ) {
      return { ...previous, ...metadata, path };
    }
    stage = "read";
    const raw = await zotero()?.File?.getContentsAsync?.(path);
    if (raw == null) throw new Error("Attachment contents are unavailable");
    const content = typeof raw === "string" ? raw : String(raw);
    stage = "stat";
    const after = await fileStamp(path);
    const stable =
      before &&
      after &&
      before.fileModified === after.fileModified &&
      before.fileSize === after.fileSize;
    stage = "parse";
    return {
      ...base,
      path,
      content,
      links: extractNoteLinks(content),
      ...(stable ? after : {}),
    };
  } catch (error) {
    let reason: NoteReadFailure["reason"] =
      stage === "path"
        ? "unavailable"
        : stage === "parse"
          ? "index-error"
          : "read-error";
    if (stage === "path") {
      try {
        // Classify only unavailable stored files with a valid native path and
        // a pending download. Never download attachments during indexing.
        const state = item.attachmentSyncState;
        if (
          item.isStoredFileAttachment?.() &&
          item.getFilePath?.() &&
          (state === 1 || state === 4)
        )
          reason = "not-downloaded";
      } catch {
        // Invalid or linked paths remain unavailable, without guessing why.
      }
    }
    const readFailure: NoteReadFailure = {
      key: metadata.key,
      title: metadata.title,
      reason,
      stage,
    };
    try {
      zotero()?.debug?.(
        `[Scholar Sketch] Note indexing unavailable ${JSON.stringify({
          libraryID: metadata.libraryID,
          ...readFailure,
          errorName: (error as { name?: string } | null)?.name,
        })}`,
      );
    } catch {
      // Diagnostics must not make an unavailable attachment break the library.
    }
    // Keep a previous successful body available for in-memory callers, but
    // always surface the read failure so it cannot masquerade as an empty note.
    return {
      ...base,
      content: previous?.content ?? "",
      ...(previous?.path ? { path: previous.path } : {}),
      readError: error instanceof Error ? error.message : String(error),
      readFailure,
    };
  }
}

function notify(libraryID: number): void {
  for (const listener of listeners) {
    try {
      listener(libraryID);
    } catch {
      // A UI subscriber must not break indexing or persistence.
    }
  }
}

/** Read all Markdown attachments in a library, using a lazy per-library cache. */
export async function readLibraryNotes(
  libraryID: number,
  options: { refresh?: boolean; changedKeys?: ReadonlySet<string> } = {},
): Promise<IndexedNoteDocument[]> {
  if (!Number.isSafeInteger(libraryID) || libraryID <= 0) return [];
  const epoch = lifecycle;
  let entry = libraries.get(libraryID);
  if (options.refresh) {
    entry = undefined;
    libraries.delete(libraryID);
  }
  if (!entry) {
    entry = {
      notes: new Map(),
      groupID: groupIDForLibrary(libraryID),
      generation: 0,
      loaded: false,
    };
    libraries.set(libraryID, entry);
  }
  if (entry.loaded) {
    if (
      entry.groupID !== groupIDForLibrary(libraryID) ||
      !cachedNotesBelongToLibrary(libraryID, entry.notes.values())
    ) {
      libraries.delete(libraryID);
      return readLibraryNotes(libraryID, options);
    }
    return [...entry.notes.values()];
  }
  if (entry.pending) return entry.pending;

  const current = entry;
  current.pending = (async () => {
    const startGeneration = current.generation;
    const persisted = options.refresh ? [] : await noteIndex().load(libraryID);
    const old = new Map(persisted.map((note) => [note.key, note]));
    for (const [key, note] of current.notes) old.set(key, note);
    const staged = new Map<string, IndexedNoteDocument>();
    const items = await loadItems(libraryID);
    let scanned = 0;
    for (const item of items) {
      if (epoch !== lifecycle) return [];
      if (++scanned % 24 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const metadata = noteMetadata(item);
      if (!metadata) continue;
      const before = current.generation;
      const previous = options.changedKeys?.has(metadata.key)
        ? undefined
        : old.get(metadata.key);
      const next = await readDocument(item, metadata, previous);
      // Saves arriving while this attachment was being read win over the scan.
      if (current.generation !== before && current.notes.has(metadata.key)) {
        const saved = current.notes.get(metadata.key)!;
        staged.set(metadata.key, {
          ...saved,
          ...(saved.path || next.path ? { path: saved.path || next.path } : {}),
        });
      } else {
        staged.set(metadata.key, next);
      }
    }
    if (epoch !== lifecycle) return [];
    if (libraries.get(libraryID) !== current)
      // The caller belongs to an invalidated generation. Follow the current
      // cache so it cannot return the old scan's empty or partial snapshot.
      return readLibraryNotes(libraryID);
    current.groupID = groupIDForLibrary(libraryID);
    if (!cachedNotesBelongToLibrary(libraryID, staged.values())) {
      current.notes = new Map();
      current.loaded = true;
      current.pending = undefined;
      return [];
    }
    // Preserve upserts that happened after the scan began, including wrappers
    // that do not expose a searchable item record yet.
    if (current.generation !== startGeneration) {
      for (const [key, value] of current.notes) {
        if (!staged.has(key)) {
          staged.set(key, value);
        } else if (value.readError === undefined) {
          const scanned = staged.get(key)!;
          staged.set(key, {
            ...value,
            ...(value.path || scanned.path
              ? { path: value.path || scanned.path }
              : {}),
          });
        }
      }
    }
    current.notes = staged;
    const generation = current.generation;
    current.indexPending = noteIndex()
      .replace(
        libraryID,
        [...staged.values()],
        () =>
          libraries.get(libraryID) === current &&
          current.generation === generation,
        options.refresh,
      )
      .then((saved) => {
        if (
          saved &&
          libraries.get(libraryID) === current &&
          current.generation === generation
        )
          current.indexedGeneration = generation;
        return saved;
      });
    current.loaded = true;
    current.pending = undefined;
    return [...current.notes.values()];
  })().catch((error) => {
    current.pending = undefined;
    throw error;
  });
  return current.pending;
}

/** Update a loaded library immediately after an editor save. */
export function updateIndexedNote(item: Zotero.Item, content: string): void {
  const metadata = noteMetadata(item);
  if (!metadata) return;
  const entry = libraries.get(metadata.libraryID);
  // An in-flight initial scan is still a valid cache target. Keeping this
  // upsert here prevents that scan from replacing a newer editor save.
  const previous = entry?.notes.get(metadata.key);
  const note: NoteDocument = {
    ...metadata,
    content,
    links: extractNoteLinks(content),
    ...(previous?.path ? { path: previous.path } : {}),
  };
  // No file stamp: a later scan must verify this body against the actual file.
  const saved = noteIndex().save(note);
  if (!entry) return;
  const previousGeneration = entry.generation;
  entry.generation += 1;
  const generation = entry.generation;
  entry.indexPending = saved.then((success) => {
    if (success && entry.indexedGeneration === previousGeneration)
      entry.indexedGeneration = generation;
    return success;
  });
  entry.notes.set(metadata.key, note);
  notify(metadata.libraryID);
}

/** A current snapshot and its candidate index must describe the same generation. */
export async function readLibrarySearchCandidates(
  libraryID: number,
  query: string,
  isCancelled: () => boolean = () => false,
): Promise<NoteDocument[]> {
  const epoch = lifecycle;
  const cancelled = () => epoch !== lifecycle || isCancelled();
  while (!cancelled()) {
    const notes = await readLibraryNotes(libraryID);
    if (cancelled()) return [];
    const current = libraries.get(libraryID);
    if (!current) return notes;
    await current.indexPending;
    if (cancelled()) return [];
    if (libraries.get(libraryID) !== current) continue;
    const generation = current.generation;
    if (current.indexedGeneration !== generation) {
      current.indexPending = noteIndex().replace(
        libraryID,
        [...current.notes.values()],
        () =>
          libraries.get(libraryID) === current &&
          current.generation === generation,
      );
      const saved = await current.indexPending;
      if (cancelled()) return [];
      if (
        libraries.get(libraryID) !== current ||
        current.generation !== generation
      )
        continue;
      if (!saved) return [...current.notes.values()];
      current.indexedGeneration = generation;
    }
    const keys = await noteIndex().searchCandidateKeys(libraryID, query);
    if (cancelled()) return [];
    if (
      libraries.get(libraryID) !== current ||
      current.generation !== generation
    )
      continue;
    const snapshot = [...current.notes.values()];
    // Candidate row order changes on saves; preserve the library's established
    // order so the same first 100 matches remain visible.
    return keys ? snapshot.filter((note) => keys.has(note.key)) : snapshot;
  }
  return [];
}

export function invalidateNoteLibrary(libraryID: number): void {
  libraries.delete(libraryID);
  notify(libraryID);
}

/** Force a rebuild from source files, even if file timestamps were preserved. */
export async function rebuildNoteLibrary(libraryID: number): Promise<void> {
  await readLibraryNotes(libraryID, { refresh: true });
  notify(libraryID);
}

export function subscribeNoteLibrary(listener: NoteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearNoteLibraries(): void {
  lifecycle++;
  if (backgroundTimer !== undefined) clearTimeout(backgroundTimer);
  backgroundTimer = undefined;
  pendingLibraries.clear();
  if (observerID !== undefined) {
    Zotero.Notifier.unregisterObserver(observerID);
    observerID = undefined;
  }
  for (const [win, binding] of windows)
    win.removeEventListener("focus", binding.onFocus);
  windows.clear();
  libraries.clear();
  listeners.clear();
}

function lineExcerpt(content: string, position: number): string {
  const from = Math.max(0, content.lastIndexOf("\n", position - 1) + 1);
  const end = content.indexOf("\n", position);
  return content
    .slice(from, end < 0 ? content.length : end)
    .trim()
    .slice(0, 240);
}

export async function getNoteBacklinks(item: Zotero.Item): Promise<{
  entries: {
    key: string;
    libraryID: number;
    title: string;
    filename: string;
    href: string;
    excerpt: string;
    position: number;
  }[];
  unreadable: number;
  failures: NoteReadFailure[];
}> {
  const target = noteMetadata(item);
  if (!target) return { entries: [], unreadable: 0, failures: [] };
  const notes = await readLibraryNotes(target.libraryID);
  const entries: {
    key: string;
    libraryID: number;
    title: string;
    filename: string;
    href: string;
    excerpt: string;
    position: number;
  }[] = [];
  const failures: NoteReadFailure[] = [];
  for (const source of notes) {
    if (source.key === target.key) continue;
    if (source.readError) {
      failures.push(
        source.readFailure ?? {
          key: source.key,
          title: source.title,
          reason: "read-error",
          stage: "read",
        },
      );
      continue;
    }
    for (const link of source.links ?? extractNoteLinks(source.content)) {
      const resolved = resolveNoteLink(link.href, source, notes);
      if (resolved.status !== "resolved" || resolved.note.key !== target.key)
        continue;
      entries.push({
        key: source.key,
        libraryID: source.libraryID,
        title: source.title,
        filename: source.filename,
        href: formatNoteLink(source),
        excerpt: lineExcerpt(source.content, link.from),
        position: link.from,
      });
    }
  }
  return { entries, unreadable: failures.length, failures };
}
