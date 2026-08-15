/**
 * Parent-side markdown editor: mounts a chrome:// iframe that runs
 * CodeMirror 6 in a stable Web document, and bridges via postMessage.
 */
import { getPref } from "../../utils/prefs";
import { ensureDOMGlobals } from "../../utils/dom";
import {
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  applyDocChanges,
  computeStats,
  type EditorMode,
  type ImageAssetMap,
  type EditorStats,
  type EditorTheme,
  type EditorToParentMessage,
  isEditorProtocolMessageForChannel,
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
  requestSnapshot: () => Promise<string>;
  setValue: (value: string) => void;
  replaceRange: (from: number, to: number, insert: string) => void;
  focus: () => void;
  destroy: () => void;
  getStats: () => EditorStats;
  command: (command: "undo" | "redo" | "find") => void;
  insertText: (
    text: string,
    selectionFrom?: number,
    selectionTo?: number,
  ) => void;
  wrapSelection: (before: string, after?: string) => void;
  prefixLine: (prefix: string) => void;
  /** Push light/dark to the iframe CM theme (also auto-synced from OS/Zotero). */
  setTheme: (theme: EditorTheme) => void;
  /** Switch Live Preview vs full Source mode inside the iframe. */
  setMode: (mode: EditorMode) => void;
  setImageAssets: (assets: ImageAssetMap) => void;
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

type PendingCommand = Extract<
  ParentToEditorMessage,
  {
    type:
      | "setValue"
      | "replaceRange"
      | "insertText"
      | "command"
      | "wrapSelection"
      | "prefixLine"
      | "focus"
      | "requestMeasure"
      | "setTheme"
      | "setFontSize"
      | "setReadOnly"
      | "setMode"
      | "setImageAssets"
      | "requestSnapshot"
      | "assetResolved"
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
    onPasteImage?: (payload: {
      bytes: ArrayBuffer;
      mimeType: string;
      name: string;
    }) => void;
    onResolveAsset?: (
      reference: string,
    ) => Promise<{ dataUrl?: string; error?: string }>;
    win?: Window;
    channel?: string;
  } = {},
): MarkdownEditorHandle {
  const {
    doc = "",
    readOnly = false,
    onChange,
    onSave,
    onPasteImage,
    onResolveAsset,
  } = options;

  const ownerWin =
    options.win || parent.ownerDocument?.defaultView || undefined;
  ensureDOMGlobals(ownerWin || undefined);

  const channel = options.channel || "";
  const documentRef = parent.ownerDocument || (globalThis as any).document;
  if (!documentRef) {
    throw new Error("No document available for markdown editor");
  }

  while (parent.firstChild) parent.removeChild(parent.firstChild);

  const wrap = documentRef.createElement("div");
  wrap.className = "zmd-editor-wrap";

  const iframe = documentRef.createElement("iframe") as HTMLIFrameElement;
  iframe.className = "zmd-codemirror-iframe";
  iframe.setAttribute(
    "src",
    `${editorPageURL()}?channel=${encodeURIComponent(channel)}`,
  );
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
  let snapshotSeq = 0;
  const pendingSnapshots = new Map<
    number,
    { resolve: (value: string) => void; timer: number }
  >();
  const pending: PendingCommand[] = [];

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const post = (message: ParentToEditorMessage) => {
    const target = iframe.contentWindow;
    if (!target) return false;
    target.postMessage(
      { ...message, channel, v: EDITOR_PROTOCOL_VERSION },
      "*",
    );
    return true;
  };

  let currentMode: EditorMode = "live";

  const sendOrQueue = (message: PendingCommand) => {
    if (destroyed) return;
    if (!iframeReady) {
      // Keep only the latest setValue / init / setTheme / setFontSize / setReadOnly / setMode
      if (
        message.type === "setValue" ||
        message.type === "replaceRange" ||
        message.type === "insertText" ||
        message.type === "init" ||
        message.type === "setTheme" ||
        message.type === "setFontSize" ||
        message.type === "setReadOnly" ||
        message.type === "setMode" ||
        message.type === "setImageAssets"
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
    if (!isEditorProtocolMessageForChannel(event.data, channel)) return;

    const data = event.data as EditorToParentMessage;
    switch (data.type) {
      case "ready": {
        iframeReady = true;
        // Re-resolve at ready time (theme may have changed while loading)
        currentTheme = resolveEditorTheme(ownerWin);
        post({
          source: EDITOR_MESSAGE_SOURCE,
          channel,
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
        lastValue = applyDocChanges(lastValue, data.payload.changes);
        lastStats = computeStats(lastValue);
        onChange?.(lastValue);
        break;
      }
      case "snapshot": {
        lastValue = data.payload.value;
        lastStats = data.payload.stats;
        const pendingSnapshot = pendingSnapshots.get(data.payload.requestId);
        if (pendingSnapshot) {
          pendingSnapshots.delete(data.payload.requestId);
          ownerWin?.clearTimeout?.(pendingSnapshot.timer);
          pendingSnapshot.resolve(data.payload.value);
        }
        break;
      }
      case "resolveAsset": {
        if (!onResolveAsset) break;
        const { requestId, reference } = data.payload;
        void onResolveAsset(reference).then((asset) => {
          if (destroyed) return;
          sendOrQueue({
            source: EDITOR_MESSAGE_SOURCE,
            type: "assetResolved",
            payload: { requestId, reference, ...asset },
          });
        });
        break;
      }
      case "save": {
        onSave?.();
        break;
      }
      case "pasteImage": {
        onPasteImage?.(data.payload);
        break;
      }
      case "imageDebug": {
        const message = `[Zotero Markdown][ImageDebug] ${data.payload.event}`;
        try {
          Zotero.debug(
            `${message} ${JSON.stringify(data.payload.details || {})}`,
          );
        } catch {
          ztoolkit.log(message, data.payload.details || {});
        }
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
    colorSchemeMql =
      ownerWin?.matchMedia?.("(prefers-color-scheme: dark)") || null;
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
    requestSnapshot: () => {
      if (destroyed) return Promise.resolve(lastValue);
      const requestId = ++snapshotSeq;
      return new Promise<string>((resolve) => {
        const timer = ownerWin?.setTimeout?.(() => {
          pendingSnapshots.delete(requestId);
          resolve(lastValue);
        }, 400) as unknown as number;
        pendingSnapshots.set(requestId, { resolve, timer });
        sendOrQueue({
          source: EDITOR_MESSAGE_SOURCE,
          type: "requestSnapshot",
          payload: { requestId },
        });
      });
    },
    setValue: (value: string) => {
      lastValue = value;
      lastStats = computeStats(value);
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "setValue",
        payload: { value },
      });
    },
    replaceRange: (from, to, insert) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "replaceRange",
        payload: { from, to, insert },
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
    command: (command) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "command",
        payload: { command },
      });
    },
    insertText: (text, selectionFrom, selectionTo) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "insertText",
        payload: { text, selectionFrom, selectionTo },
      });
    },
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
    setImageAssets: (assets: ImageAssetMap) => {
      sendOrQueue({
        source: EDITOR_MESSAGE_SOURCE,
        type: "setImageAssets",
        payload: { assets },
      });
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const [id, pendingSnapshot] of pendingSnapshots) {
        ownerWin?.clearTimeout?.(pendingSnapshot.timer);
        pendingSnapshot.resolve(lastValue);
        pendingSnapshots.delete(id);
      }
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
