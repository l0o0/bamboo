/**
 * iframe-side entry: runs CodeMirror 6 inside a clean Web document.
 * Communicates with the parent Zotero tab via postMessage.
 *
 * This file is bundled into chrome://.../editor/editor.js and runs in a
 * real browser document (not the Zotero plugin sandbox). DOM types apply.
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  EDITOR_MESSAGE_SOURCE,
  computeStats,
  isEditorProtocolMessage,
  type EditorInitPayload,
  type EditorTheme,
  type ParentToEditorMessage,
} from "../modules/markdown/editor-protocol";
import { editorThemeExtension } from "./theme";

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const fontCompartment = new Compartment();

let view: EditorView | null = null;
let currentTheme: EditorTheme = "light";
let currentFontSize = 14;

function postToParent(message: {
  type: "ready" | "change" | "save" | "error";
  payload?: unknown;
}) {
  // Parent is the Zotero chrome window that hosts the iframe
  window.parent?.postMessage(
    { source: EDITOR_MESSAGE_SOURCE, ...message },
    "*",
  );
}

function buildExtensions(init: EditorInitPayload): Extension[] {
  currentTheme = init.theme;
  currentFontSize = init.fontSize;

  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    history(),
    foldGutter(),
    bracketMatching(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    // Avoid @codemirror/language-data (multi-MB). Fenced code stays plain text.
    markdown(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
      {
        key: "Mod-s",
        run: () => {
          postToParent({ type: "save" });
          return true;
        },
      },
      {
        key: "Mod-b",
        run: (v) => {
          wrapSelectionInView(v, "**", "**");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: (v) => {
          wrapSelectionInView(v, "*", "*");
          return true;
        },
      },
      {
        key: "Mod-k",
        run: (v) => {
          wrapSelectionInView(v, "[", "](url)");
          return true;
        },
      },
      {
        key: "Mod-1",
        run: (v) => {
          prefixLineInView(v, "# ");
          return true;
        },
      },
      {
        key: "Mod-2",
        run: (v) => {
          prefixLineInView(v, "## ");
          return true;
        },
      },
      {
        key: "Mod-3",
        run: (v) => {
          prefixLineInView(v, "### ");
          return true;
        },
      },
    ]),
    themeCompartment.of(editorThemeExtension(init.theme, init.fontSize)),
    fontCompartment.of([]),
    readOnlyCompartment.of([
      EditorState.readOnly.of(!!init.readOnly),
      EditorView.editable.of(!init.readOnly),
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const value = update.state.doc.toString();
      postToParent({
        type: "change",
        payload: { value, stats: computeStats(value) },
      });
    }),
    EditorView.domEventHandlers({
      // prevent Zotero chrome from swallowing some keys inconsistently
    }),
  ];
}

function wrapSelectionInView(v: EditorView, before: string, after: string) {
  const { from, to } = v.state.selection.main;
  const selected = v.state.doc.sliceString(from, to);
  const insert = before + selected + after;
  const selection = selected
    ? { anchor: from, head: from + insert.length }
    : { anchor: from + before.length, head: from + before.length };
  v.dispatch({
    changes: { from, to, insert },
    selection,
  });
  v.focus();
}

function prefixLineInView(v: EditorView, prefix: string) {
  const { from } = v.state.selection.main;
  const line = v.state.doc.lineAt(from);
  const stripped = line.text.replace(/^#{1,6}\s+/, "");
  const newLine = prefix + stripped;
  v.dispatch({
    changes: { from: line.from, to: line.to, insert: newLine },
    selection: { anchor: line.from + newLine.length },
  });
  v.focus();
}

function createOrResetEditor(init: EditorInitPayload) {
  const host = document.getElementById("editor-root");
  if (!host) {
    postToParent({
      type: "error",
      payload: { message: "Missing #editor-root" },
    });
    return;
  }

  if (view) {
    view.destroy();
    view = null;
  }

  const state = EditorState.create({
    doc: init.doc ?? "",
    extensions: buildExtensions(init),
  });

  view = new EditorView({
    state,
    parent: host,
  });

  // Do not post initial change — parent already has the doc cache.
  // Posting would falsely mark the session dirty on open.
}

function handleParentMessage(data: ParentToEditorMessage) {
  switch (data.type) {
    case "init":
      createOrResetEditor(data.payload);
      break;
    case "setValue": {
      if (!view) return;
      const value = data.payload.value;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
      });
      break;
    }
    case "wrapSelection": {
      if (!view) return;
      wrapSelectionInView(
        view,
        data.payload.before,
        data.payload.after ?? data.payload.before,
      );
      break;
    }
    case "prefixLine": {
      if (!view) return;
      prefixLineInView(view, data.payload.prefix);
      break;
    }
    case "focus":
      view?.focus();
      break;
    case "requestMeasure":
      view?.requestMeasure();
      break;
    case "setTheme": {
      if (!view) return;
      currentTheme = data.payload.theme;
      view.dispatch({
        effects: themeCompartment.reconfigure(
          editorThemeExtension(currentTheme, currentFontSize),
        ),
      });
      break;
    }
    case "setFontSize": {
      if (!view) return;
      currentFontSize = data.payload.fontSize;
      view.dispatch({
        effects: themeCompartment.reconfigure(
          editorThemeExtension(currentTheme, currentFontSize),
        ),
      });
      break;
    }
    case "setReadOnly": {
      if (!view) return;
      const readOnly = !!data.payload.readOnly;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      });
      break;
    }
    case "destroy": {
      view?.destroy();
      view = null;
      break;
    }
    default:
      break;
  }
}

const PARENT_TO_EDITOR_TYPES = new Set([
  "init",
  "setValue",
  "wrapSelection",
  "prefixLine",
  "focus",
  "requestMeasure",
  "setTheme",
  "setFontSize",
  "setReadOnly",
  "destroy",
]);

function onWindowMessage(event: MessageEvent) {
  if (!isEditorProtocolMessage(event.data)) return;
  if (!PARENT_TO_EDITOR_TYPES.has(event.data.type)) return;
  const data = event.data as ParentToEditorMessage;
  try {
    handleParentMessage(data);
  } catch (e) {
    postToParent({
      type: "error",
      payload: {
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

function boot() {
  window.addEventListener("message", onWindowMessage);
  // Signal readiness so parent can send init
  postToParent({ type: "ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
