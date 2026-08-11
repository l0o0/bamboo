import { getPref } from "../../utils/prefs";
import { ensureDOMGlobals } from "../../utils/dom";

/**
 * Plain-textarea markdown editor with synced line numbers.
 * Stable under Zotero XUL (unlike CodeMirror virtualization).
 */

export interface MarkdownEditorHandle {
  view: {
    requestMeasure: () => void;
    focus: () => void;
    contentDOM: HTMLElement;
    scrollDOM: HTMLElement;
  };
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  destroy: () => void;
  getStats: () => { chars: number; lines: number; words: number };
  /** Toolbar / shortcut helpers */
  wrapSelection: (before: string, after?: string) => void;
  prefixLine: (prefix: string) => void;
}

const LINE_HEIGHT = "22px";
const FONT_FAMILY =
  'ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function createMarkdownEditor(
  parent: HTMLElement,
  options: {
    doc?: string;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    onSave?: () => void;
    win?: Window;
  } = {},
): MarkdownEditorHandle {
  const { doc = "", readOnly = false, onChange, onSave } = options;

  const ownerWin =
    options.win || parent.ownerDocument?.defaultView || undefined;
  ensureDOMGlobals(ownerWin || undefined);

  const documentRef = parent.ownerDocument || (globalThis as any).document;
  if (!documentRef) {
    throw new Error("No document available for markdown editor");
  }

  while (parent.firstChild) parent.removeChild(parent.firstChild);

  const fontSize = resolveFontSize();

  const wrap = documentRef.createElement("div");
  wrap.className = "zmd-editor-wrap";

  const gutter = documentRef.createElement("div");
  gutter.className = "zmd-gutter";
  gutter.setAttribute("aria-hidden", "true");

  const textarea = documentRef.createElement("textarea");
  textarea.className = "zmd-textarea";
  textarea.value = doc;
  textarea.spellcheck = false;
  textarea.wrap = "off";
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("placeholder", "Start writing in Markdown…");
  if (readOnly) textarea.readOnly = true;

  const metrics = {
    fontFamily: FONT_FAMILY,
    fontSize,
    lineHeight: LINE_HEIGHT,
    tabSize: "4",
  };
  Object.assign(textarea.style, {
    fontFamily: metrics.fontFamily,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    tabSize: metrics.tabSize,
  });
  Object.assign(gutter.style, {
    fontFamily: metrics.fontFamily,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
  });

  wrap.append(gutter, textarea);
  parent.appendChild(wrap);

  let destroyed = false;

  const countLines = (text: string) => {
    if (!text) return 1;
    let n = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) n++;
    }
    return n;
  };

  const countWords = (text: string) => {
    const t = text.trim();
    if (!t) return 0;
    const cjk = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const rest = t
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return (cjk?.length || 0) + rest.length;
  };

  const renderGutter = () => {
    if (destroyed) return;
    const lines = countLines(textarea.value);
    const parts = new Array(lines);
    for (let i = 0; i < lines; i++) parts[i] = String(i + 1);
    gutter.textContent = parts.join("\n");
  };

  const syncScroll = () => {
    gutter.scrollTop = textarea.scrollTop;
  };

  const onInput = () => {
    renderGutter();
    syncScroll();
    onChange?.(textarea.value);
  };

  const wrapSelection = (before: string, after: string = before) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const v = textarea.value;
    const selected = v.slice(start, end);
    textarea.value =
      v.slice(0, start) + before + selected + after + v.slice(end);
    if (selected) {
      textarea.selectionStart = start;
      textarea.selectionEnd = end + before.length + after.length;
    } else {
      textarea.selectionStart = textarea.selectionEnd = start + before.length;
    }
    textarea.focus();
    onInput();
  };

  const prefixLine = (prefix: string) => {
    const start = textarea.selectionStart;
    const v = textarea.value;
    const lineStart = v.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = v.indexOf("\n", start);
    const lineEnd = lineEndIdx === -1 ? v.length : lineEndIdx;
    const line = v.slice(lineStart, lineEnd);
    const stripped = line.replace(/^#{1,6}\s+/, "");
    const newLine = prefix + stripped;
    textarea.value = v.slice(0, lineStart) + newLine + v.slice(lineEnd);
    const pos = lineStart + newLine.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.focus();
    onInput();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    const mod = ev.ctrlKey || ev.metaKey;

    if (ev.key === "Tab" && !mod && !ev.altKey) {
      ev.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const v = textarea.value;
      const insert = "  ";
      textarea.value = v.slice(0, start) + insert + v.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + insert.length;
      onInput();
      return;
    }

    if (mod && (ev.key === "s" || ev.key === "S")) {
      ev.preventDefault();
      onSave?.();
      return;
    }
    if (mod && !ev.altKey && (ev.key === "b" || ev.key === "B")) {
      ev.preventDefault();
      wrapSelection("**");
      return;
    }
    if (mod && !ev.altKey && (ev.key === "i" || ev.key === "I")) {
      ev.preventDefault();
      wrapSelection("*");
      return;
    }
    if (mod && !ev.altKey && (ev.key === "k" || ev.key === "K")) {
      ev.preventDefault();
      wrapSelection("[", "](url)");
      return;
    }
    if (mod && (ev.key === "1" || ev.key === "2" || ev.key === "3")) {
      ev.preventDefault();
      prefixLine("#".repeat(Number(ev.key)) + " ");
    }
  };

  textarea.addEventListener("input", onInput);
  textarea.addEventListener("scroll", syncScroll, { passive: true });
  textarea.addEventListener("keydown", onKeyDown);

  renderGutter();

  const win = ownerWin || documentRef.defaultView;
  win?.requestAnimationFrame?.(() => {
    renderGutter();
    syncScroll();
  });
  win?.setTimeout?.(() => {
    renderGutter();
    syncScroll();
  }, 50);

  return {
    view: {
      requestMeasure: () => {
        renderGutter();
        syncScroll();
      },
      focus: () => textarea.focus(),
      contentDOM: textarea,
      scrollDOM: textarea,
    },
    getValue: () => textarea.value,
    setValue: (value: string) => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = value;
      const len = value.length;
      textarea.selectionStart = Math.min(start, len);
      textarea.selectionEnd = Math.min(end, len);
      renderGutter();
      syncScroll();
    },
    focus: () => textarea.focus(),
    getStats: () => {
      const value = textarea.value;
      return {
        chars: value.length,
        lines: countLines(value),
        words: countWords(value),
      };
    },
    wrapSelection,
    prefixLine,
    destroy: () => {
      destroyed = true;
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("scroll", syncScroll);
      textarea.removeEventListener("keydown", onKeyDown);
      while (parent.firstChild) parent.removeChild(parent.firstChild);
    },
  };
}

function resolveFontSize(): string {
  const n = Number(getPref("fontSize") || 14);
  const size = Number.isFinite(n) ? Math.min(22, Math.max(11, n)) : 14;
  return `${size}px`;
}
