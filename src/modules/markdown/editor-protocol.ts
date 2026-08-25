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

export interface EditorInitPayload {
  doc: string;
  readOnly: boolean;
  fontSize: number;
  theme: EditorTheme;
  /** Default interpreted as `"live"` by the iframe bootstrap. */
  mode?: EditorMode;
  /** Layout density for the editor host. */
  surface?: EditorSurface;
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
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "destroy" }
) &
  EditorProtocolMessage;

/** iframe → parent */
export type EditorToParentMessage = (
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
        stats: EditorStats;
      };
    }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "resolveAsset";
      payload: { requestId: number; reference: string };
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
  return msg.source === EDITOR_MESSAGE_SOURCE && typeof msg.type === "string";
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
