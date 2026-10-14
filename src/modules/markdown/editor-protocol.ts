import type { FontFamilyID } from "./preferences";
import { validViewState, type DocumentViewState } from "./editor-view-state";
import { parseDocumentLink } from "./document-link-shared";
import { parseNoteLink, portableNoteFilename } from "./note-links";
import type { EditorTableLabels } from "../../editor/table-labels";
import { config } from "../../../package.json";

/**
 * postMessage protocol between the Zotero tab (parent) and the
 * chrome:// editor iframe (CodeMirror host).
 */

export const EDITOR_MESSAGE_SOURCE = "zotero-markdown-editor" as const;
export const EDITOR_PROTOCOL_VERSION = 1;

export type EditorTheme = "light" | "dark";
export type EditorSurface = "default" | "sidebar";

/** Live Preview (document-like) vs full raw source. */
export type EditorMode = "live" | "source";

export interface EditorStats {
  chars: number;
  lines: number;
  words: number;
}

export type EditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface EditorOutlineItem {
  id: string;
  level: EditorHeadingLevel;
  text: string;
  from: number;
}

export type EditorCommand = "undo" | "redo" | "find";

export interface ImageAssetMap {
  [reference: string]: { dataUrl?: string; error?: string };
}

/** Serializable metadata shown by the [[…]] completion popup. */
export type EditorLinkFilter = "all" | "regular" | "notes-attachments" | "open";

export interface EditorLinkLabels {
  all: string;
  regular: string;
  notesAttachments: string;
  open: string;
  empty: string;
  loading: string;
}

export interface EditorLinkCandidate {
  key: string;
  libraryID: number;
  groupID?: number;
  title: string;
  kind: "markdown" | "canvas" | "regular" | "note" | "attachment";
  kindLabel?: string;
  /** First creator display name, when the item has creator metadata. */
  author?: string;
  /** Packaged Zotero or addon icon; external image URLs are never accepted. */
  icon?: string;
  href: string;
  /** Original Markdown attachment filename; enables portable Wiki insertion. */
  filename?: string;
  heading?: string;
}

export interface EditorAppearance {
  fontFamily: FontFamilyID;
  backgroundColor: string;
}

export interface EditorInitPayload {
  appearance?: EditorAppearance;
  doc: string;
  readOnly: boolean;
  fontSize: number;
  theme: EditorTheme;
  /** Default interpreted as `"live"` by the iframe bootstrap. */
  mode?: EditorMode;
  /** Layout density for the editor host. */
  surface?: EditorSurface;
  imageLabels?: EditorImageLabels;
  tableLabels?: EditorTableLabels;
  linkLabels?: EditorLinkLabels;
  viewState?: DocumentViewState;
}

export interface EditorImageLabels {
  toolbar: string;
  width: string;
  small: string;
  medium: string;
  large: string;
  auto: string;
  original: string;
  close: string;
  resize: string;
}

export interface EditorDocChange {
  from: number;
  to: number;
  insert: string;
}

export type EditorProtocolMessage = {
  source: typeof EDITOR_MESSAGE_SOURCE;
  channel?: string;
  v?: typeof EDITOR_PROTOCOL_VERSION;
};

/** Parent → iframe */
export type ParentToEditorMessage = (
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "init";
      payload: EditorInitPayload;
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setValue";
      payload: { value: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "replaceRange";
      payload: { from: number; to: number; insert: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "insertText";
      payload: { text: string; selectionFrom?: number; selectionTo?: number };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "command";
      payload: { command: EditorCommand };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "wrapSelection";
      payload: { before: string; after?: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "prefixLine";
      payload: { prefix: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "revealPosition";
      payload: { position: number };
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "focus" }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "requestMeasure" }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setTheme";
      payload: { theme: EditorTheme };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setAppearance";
      payload: EditorAppearance;
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setFontSize";
      payload: { fontSize: number };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setReadOnly";
      payload: { readOnly: boolean };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setMode";
      payload: { mode: EditorMode };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "setImageAssets";
      payload: {
        assets: ImageAssetMap;
        /**
         * `true` (default) replaces the iframe's whole asset map — the
         * parent sends the complete set for the current document. `false`
         * merges a single newly resolved asset so a partial push (e.g. right
         * after an image insert) does not drop already-loaded images.
         */
        replace?: boolean;
      };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "requestSnapshot";
      payload: { requestId: number };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "assetResolved";
      payload: {
        requestId: number;
        reference: string;
        dataUrl?: string;
        error?: string;
      };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "linkSearchResults";
      payload: {
        requestId: number;
        query: string;
        filter?: EditorLinkFilter;
        results: EditorLinkCandidate[];
      };
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "destroy" }
) &
  EditorProtocolMessage;

/** iframe → parent */
export type EditorToParentMessage = (
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "composition";
      payload: { active: boolean };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "viewState";
      payload: DocumentViewState;
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "ready" }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "outline";
      payload: { items: EditorOutlineItem[]; activeID: string | null };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "outlineActive";
      payload: { activeID: string | null };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "change";
      payload: { rev: number; changes: EditorDocChange[] };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "snapshot";
      payload: {
        requestId: number;
        rev: number;
        value: string;
        /** Exact statistics for this snapshot value, reusable by the parent. */
        stats: EditorStats;
      };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "resolveAsset";
      payload: { requestId: number; reference: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "linkSearch";
      payload: { requestId: number; query: string; filter?: EditorLinkFilter };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "openLink";
      payload: { href: string };
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "save" }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "imageDebug";
      payload: { event: string; details?: Record<string, unknown> };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "pasteImage";
      payload: { bytes: ArrayBuffer; mimeType: string; name: string };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "error";
      payload: { message: string };
    }
) &
  EditorProtocolMessage;

export function isEditorProtocolMessageForChannel(
  data: unknown,
  channel: string,
): data is EditorToParentMessage {
  return (
    isEditorProtocolMessage(data) &&
    (data as EditorProtocolMessage).channel === channel
  );
}

export function isEditorProtocolMessage(
  data: unknown,
): data is ParentToEditorMessage | EditorToParentMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as { source?: string; type?: string };
  if (msg.source !== EDITOR_MESSAGE_SOURCE || typeof msg.type !== "string") {
    return false;
  }
  return isLinkMessagePayloadValid(data as Record<string, unknown>);
}

function isLinkMessagePayloadValid(data: Record<string, unknown>): boolean {
  if (data.type === "composition") {
    const payload = data.payload as { active?: unknown } | null;
    return (
      !!payload &&
      typeof payload === "object" &&
      typeof payload.active === "boolean"
    );
  }
  if (data.type === "setAppearance") {
    const payload = data.payload as Partial<EditorAppearance> | null;
    return (
      !!payload &&
      typeof payload === "object" &&
      ["system", "serif", "mono"].includes(payload.fontFamily as string) &&
      typeof payload.backgroundColor === "string" &&
      (payload.backgroundColor === "" ||
        /^#[\da-f]{6}$/i.test(payload.backgroundColor))
    );
  }
  if (data.type === "viewState") return validViewState(data.payload);
  if (data.type === "openLink") {
    const payload = data.payload;
    return (
      !!payload &&
      typeof payload === "object" &&
      typeof (payload as { href?: unknown }).href === "string" &&
      (payload as { href: string }).href.length > 0 &&
      (payload as { href: string }).href.length <= 4096
    );
  }
  if (data.type === "linkSearch") {
    const payload = data.payload as {
      requestId?: unknown;
      query?: unknown;
      filter?: unknown;
    };
    return (
      !!payload &&
      typeof payload === "object" &&
      validRequestID(payload.requestId) &&
      typeof payload.query === "string" &&
      payload.query.length <= 512 &&
      (payload.filter === undefined || isEditorLinkFilter(payload.filter))
    );
  }
  if (data.type === "linkSearchResults") {
    const payload = data.payload as {
      requestId?: unknown;
      query?: unknown;
      filter?: unknown;
      results?: unknown;
    };
    return (
      !!payload &&
      typeof payload === "object" &&
      validRequestID(payload.requestId) &&
      typeof payload.query === "string" &&
      payload.query.length <= 512 &&
      (payload.filter === undefined || isEditorLinkFilter(payload.filter)) &&
      Array.isArray(payload.results) &&
      payload.results.length <= 24 &&
      payload.results.every(isEditorLinkCandidate)
    );
  }
  return true;
}

function validRequestID(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isEditorLinkFilter(value: unknown): value is EditorLinkFilter {
  return (
    value === "all" ||
    value === "regular" ||
    value === "notes-attachments" ||
    value === "open"
  );
}

export function isEditorLinkIcon(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  const prefix = value.startsWith("chrome://zotero/skin/")
    ? "chrome://zotero/skin/"
    : `chrome://${config.addonRef}/content/icons/`;
  if (!value.startsWith(prefix)) return false;
  const path = value.slice(prefix.length);
  return (
    /^[A-Za-z0-9_/@.-]+\.(?:svg|png)$/.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isEditorLinkCandidate(value: unknown): value is EditorLinkCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EditorLinkCandidate>;
  const reference =
    typeof candidate.href === "string"
      ? parseDocumentLink(candidate.href)
      : null;
  const zoteroHrefMatchesCandidate =
    reference !== null &&
    reference.key === candidate.key &&
    ((candidate.groupID === undefined && reference.scope === "library") ||
      (typeof candidate.groupID === "number" &&
        reference.scope === "group" &&
        reference.groupID === candidate.groupID));
  const fileReference =
    typeof candidate.href === "string" ? parseNoteLink(candidate.href) : null;
  const fileHrefMatchesCandidate =
    candidate.kind === "markdown" &&
    typeof candidate.filename === "string" &&
    candidate.filename.length > 0 &&
    candidate.filename.length <= 1000 &&
    typeof candidate.key === "string" &&
    /^[A-Za-z0-9]{8}$/.test(candidate.key) &&
    fileReference?.target ===
      portableNoteFilename({
        filename: candidate.filename,
        key: candidate.key,
      }) &&
    fileReference.heading === candidate.heading;
  return (
    typeof candidate.key === "string" &&
    /^[A-Za-z0-9]{8}$/.test(candidate.key) &&
    typeof candidate.libraryID === "number" &&
    Number.isSafeInteger(candidate.libraryID) &&
    candidate.libraryID > 0 &&
    (candidate.groupID === undefined ||
      (typeof candidate.groupID === "number" &&
        Number.isSafeInteger(candidate.groupID) &&
        candidate.groupID > 0)) &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    candidate.title.length <= 1000 &&
    (candidate.kindLabel === undefined ||
      (typeof candidate.kindLabel === "string" &&
        candidate.kindLabel.length > 0 &&
        candidate.kindLabel.length <= 100)) &&
    (candidate.author === undefined ||
      (typeof candidate.author === "string" &&
        candidate.author.trim().length > 0 &&
        candidate.author.length <= 200)) &&
    (candidate.icon === undefined || isEditorLinkIcon(candidate.icon)) &&
    (candidate.kind === "markdown" ||
      candidate.kind === "canvas" ||
      candidate.kind === "regular" ||
      candidate.kind === "note" ||
      candidate.kind === "attachment") &&
    typeof candidate.href === "string" &&
    candidate.href.length <= 4096 &&
    (candidate.filename === undefined ||
      (typeof candidate.filename === "string" &&
        candidate.filename.length > 0 &&
        candidate.filename.length <= 1000)) &&
    (candidate.heading === undefined ||
      (typeof candidate.heading === "string" &&
        candidate.heading.length <= 1000)) &&
    (zoteroHrefMatchesCandidate || fileHrefMatchesCandidate)
  );
}

/** Apply non-overlapping original-document changes from last to first. */
export function applyDocChanges(
  value: string,
  changes: readonly EditorDocChange[],
): string {
  let next = value;
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    next = next.slice(0, change.from) + change.insert + next.slice(change.to);
  }
  return next;
}

/** Exact UTF-16 chars, LF lines and Chinese-character/whitespace word counts. */
export function computeStats(text: string): EditorStats {
  return {
    chars: text.length,
    lines: countLines(text),
    words: countWords(text),
  };
}

function countLines(text: string): number {
  if (!text) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const cjk = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const rest = t
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (cjk?.length || 0) + rest.length;
}
