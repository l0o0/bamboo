/**
 * Parent-side markdown editor: mounts a chrome:// iframe that runs
 * CodeMirror 6 in a stable Web document, and bridges via postMessage.
 */
import { getPref } from "../../utils/prefs";
import { ensureDOMGlobals } from "../../utils/dom";
import {
  EDITOR_MESSAGE_SOURCE,
  computeStats,
  isEditorProtocolMessage,
  type EditorMode,
  type EditorStats,
  type EditorTheme,
  type EditorToParentMessage,
  type ParentToEditorMessage,
} from "./editor-protocol";

export type { EditorMode };

export interface MarkdownEditorHandle {
  ready: Promise<void>;
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
  getStats: () => EditorStats;
  wrapSelection: (before: string, after?: string) => void;
  prefixLine: (prefix: string) => void;
  /** Push light/dark to the iframe CM theme (also auto-synced from OS/Zotero). */
  setTheme: (theme: EditorTheme) => void;
  /** Switch Live Preview vs full Source mode inside the iframe. */
  setMode: (mode: EditorMode) => void;
}

/** Shared dark-mode detection (Zotero follows prefers-color-scheme). */
export function resolveEditorTheme(win?: Window): EditorTheme {
  try {
    if (win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
      return "dark";
    }
  } catch {
    // ignore
  }
  try {
    const root = win?.document?.documentElement;
    const theme =
      root?.getAttribute("data-theme") || root?.getAttribute("theme") || "";
    if (/dark/i.test(theme)) return "dark";
    if (root?.classList?.contains("theme-dark")) return "dark";
    if (root?.classList?.contains("theme-light")) return "light";
  } catch {
    // ignore
  }
  return "light";
}

type PendingCommand =
  | Extract<
      ParentToEditorMessage,
      {
        type:
          | "setValue"
          | "wrapSelection"
          | "prefixLine"
          | "focus"
          | "requestMeasure"
          | "setTheme"
          | "setFontSize"
          | "setReadOnly"
          | "setMode"
          | "init";
      }
    >;

function editorPageURL(): string {
  const ref = addon.data.config.addonRef;
  return `chrome://${ref}/content/editor/index.html`;
}

function resolveFontSize(): number {
  const n = Number(getPref("fontSize") || 14);
  return Number.isFinite(n) ? Math.min(22, Math.max(11, n)) : 14;
}

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

  const wrap = documentRef.createElement("div");
  wrap.className = "zmd-editor-wrap";

  const iframe = documentRef.createElement("iframe") as HTMLIFrameElement;
  iframe.className = "zmd-codemirror-iframe";
  iframe.setAttribute("src", editorPageURL());
  Object.assign(iframe.style, {
    border: "none",
    width: "100%",
    height: "100%",
    flex: "1 1 auto",
    minHeight: "0",
    minWidth: "0",
    display: "block",
    background: "transparent",
  });

  wrap.appendChild(iframe);
  parent.appendChild(wrap);

  let destroyed = false;
  let iframeReady = false;
  let lastValue = doc;
  let lastStats: EditorStats = computeStats(doc);
  const pending: PendingCommand[] = [];

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const post = (message: ParentToEditorMessage) => {
    const target = iframe.contentWindow;
    if (!target) return false;
    target.postMessage(message, "*");
    return true;
  };

  let currentMode: EditorMode = "live";

  const sendOrQueue = (message: PendingCommand) => {
    if (destroyed) return;
    if (!iframeReady) {
      // Keep only the latest setValue / init / setTheme / setFontSize / setReadOnly / setMode
      if (
        message.type === "setValue" ||
        message.type === "init" ||
        message.type === "setTheme" ||
        message.type === "setFontSize" ||
        message.type === "setReadOnly" ||
        message.type === "setMode"
      ) {
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].type === message.type) pending.splice(i, 1);
        }
      }
      pending.push(message);
      return;
    }
    post(message);
  };

  const flushPending = () => {
    const queue = pending.splice(0, pending.length);
    for (const cmd of queue) {
      post(cmd);
    }
  };

  let currentTheme = resolveEditorTheme(ownerWin);

  const applyTheme = (theme: EditorTheme) => {
    if (destroyed) return;
    if (theme === currentTheme) return;
    currentTheme = theme;
    sendOrQueue({
      source: EDITOR_MESSAGE_SOURCE,
      type: "setTheme",
      payload: { theme },
    });
  };

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    // Only accept messages from our iframe
    if (event.source && event.source !== iframe.contentWindow) return;
    if (!isEditorProtocolMessage(event.data)) return;

    const data = event.data as EditorToParentMessage;
    switch (data.type) {
      case "ready": {
        iframeReady = true;
        // Re-resolve at ready time (theme may have changed while loading)
        currentTheme = resolveEditorTheme(ownerWin);
        post({
          source: EDITOR_MESSAGE_SOURCE,
          type: "init",
          payload: {
            doc: lastValue,
            readOnly,
            fontSize: resolveFontSize(),
            theme: currentTheme,
            mode: currentMode,
          },
        });
        flushPending();
        resolveReady();
        break;
      }
      case "change": {
        lastValue = data.payload.value;
        lastStats = data.payload.stats;
        onChange?.(lastValue);
        break;
      }
      case "save": {
        onSave?.();
        break;
      }
      case "error": {
        ztoolkit.log("Markdown editor iframe error:", data.payload.message);
        break;
      }
      default:
        break;
    }
  };

  ownerWin?.addEventListener("message", onMessage);

  // Live-sync when Zotero/OS color scheme changes (same pattern as Zotero's
  // Ace/Monaco tools: matchMedia('(prefers-color-scheme: dark)').change).
  let colorSchemeMql: MediaQueryList | null = null;
  const onColorSchemeChange = () => {
    applyTheme(resolveEditorTheme(ownerWin));
  };
  try {
    colorSchemeMql = ownerWin?.matchMedia?.("(prefers-color-scheme: dark)") || null;
    colorSchemeMql?.addEventListener?.("change", onColorSchemeChange);
  } catch {
    // ignore
  }

  // Fallback: Zotero may also flip documentElement attributes/classes
  let themeObserver: MutationObserver | null = null;
  try {
    const rootEl = ownerWin?.document?.documentElement;
    if (rootEl && ownerWin?.MutationObserver) {
      const obs = new ownerWin.MutationObserver(() => {
        const next = resolveEditorTheme(ownerWin);
        if (next !== currentTheme) applyTheme(next);
      });
      obs.observe(rootEl, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "theme", "style"],
      });
      themeObserver = obs;
    }
  } catch {
    // ignore
  }

  // Fallback: if ready never arrives, still resolve after timeout so callers don't hang
  ownerWin?.setTimeout?.(() => {
    if (!iframeReady && !destroyed) {
      ztoolkit.log(
        "Markdown editor iframe ready timeout; commands will queue until ready",
      );
      // Do not resolve yet — keep waiting; getValue still works via cache
    }
  }, 8000);

  return {
    ready,
    view: {
      requestMeasure: () => {
        sendOrQueue({
          source: EDITOR_MESSAGE_SOURCE,
          type: "requestMeasure",
        });
      },
      focus: () => {
        try {
          iframe.focus();
        } catch {
          // ignore
        }
        sendOrQueue({ source: EDITOR_MESSAGE_SOURCE, type: "focus" });
      },
      contentDOM: iframe,
      scrollDOM: iframe,
    },
    getValue: () => lastValue,
    setValue: (value: string) => {
      lastValue = value;
      lastStats = computeStats(value);
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "setValue",
        payload: { value },
      });
    },
    focus: () => {
      try {
        iframe.focus();
      } catch {
        // ignore
      }
      sendOrQueue({ source: EDITOR_MESSAGE_SOURCE, type: "focus" });
    },
    getStats: () => lastStats,
    wrapSelection: (before: string, after: string = before) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "wrapSelection",
        payload: { before, after },
      });
    },
    prefixLine: (prefix: string) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "prefixLine",
        payload: { prefix },
      });
    },
    setTheme: (theme: EditorTheme) => {
      applyTheme(theme);
    },
    setMode: (mode: EditorMode) => {
      if (destroyed) return;
      currentMode = mode === "source" ? "source" : "live";
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "setMode",
        payload: { mode: currentMode },
      });
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      try {
        colorSchemeMql?.removeEventListener?.("change", onColorSchemeChange);
      } catch {
        // ignore
      }
      try {
        themeObserver?.disconnect();
      } catch {
        // ignore
      }
      try {
        post({ source: EDITOR_MESSAGE_SOURCE, type: "destroy" });
      } catch {
        // ignore
      }
      ownerWin?.removeEventListener("message", onMessage);
      try {
        while (parent.firstChild) parent.removeChild(parent.firstChild);
      } catch {
        // ignore
      }
    },
  };
}
