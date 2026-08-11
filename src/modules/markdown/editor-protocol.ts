/**
 * postMessage protocol between the Zotero tab (parent) and the
 * chrome:// editor iframe (CodeMirror host).
 */

export const EDITOR_MESSAGE_SOURCE = "zotero-markdown-editor" as const;

export type EditorTheme = "light" | "dark";

export interface EditorStats {
  chars: number;
  lines: number;
  words: number;
}

export interface EditorInitPayload {
  doc: string;
  readOnly: boolean;
  fontSize: number;
  theme: EditorTheme;
}

/** Parent → iframe */
export type ParentToEditorMessage =
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "init"; payload: EditorInitPayload }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "setValue"; payload: { value: string } }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "wrapSelection";
      payload: { before: string; after?: string };
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "prefixLine"; payload: { prefix: string } }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "focus" }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "requestMeasure" }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "setTheme"; payload: { theme: EditorTheme } }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "setFontSize"; payload: { fontSize: number } }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "setReadOnly"; payload: { readOnly: boolean } }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "destroy" };

/** iframe → parent */
export type EditorToParentMessage =
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "ready" }
  | {
      source: typeof EDITOR_MESSAGE_SOURCE;
      type: "change";
      payload: { value: string; stats: EditorStats };
    }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "save" }
  | { source: typeof EDITOR_MESSAGE_SOURCE; type: "error"; payload: { message: string } };

export function isEditorProtocolMessage(
  data: unknown,
): data is ParentToEditorMessage | EditorToParentMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as { source?: string; type?: string };
  return msg.source === EDITOR_MESSAGE_SOURCE && typeof msg.type === "string";
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
