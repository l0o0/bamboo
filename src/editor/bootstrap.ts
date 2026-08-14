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
  redo,
  undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from "@codemirror/search";
import {
  EDITOR_MESSAGE_SOURCE,
  computeStats,
  isEditorProtocolMessage,
  type EditorInitPayload,
  type EditorMode,
  type EditorTheme,
  type ParentToEditorMessage,
} from "../modules/markdown/editor-protocol";
import { editorThemeExtension } from "./theme";
import { imageDebug } from "./image-debug";
import {
  livePreviewWhen,
  setLiveImageAssets,
  setLiveTableCellEdit,
} from "./live-preview";
import { tableKeymap } from "./table";
import {
  activateTableCell,
  planCellInput,
  planCellNavigation,
  remapActiveCell,
  TABLE_CELL_COMMIT_EVENT,
  TABLE_CELL_INPUT_EVENT,
  TABLE_CELL_NAVIGATE_EVENT,
  type TableCellEditTarget,
  type TableCellInputDetail,
  type TableCellNavigateDetail,
} from "./table-cell-edit";
import {
  planTableOperation,
  tableTargetAt,
  type TableAction,
} from "./table-operations";
import {
  createTableContextMenu,
  tableMenuItems,
  type TableContextMenu,
} from "./table-menu";

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const liveCompartment = new Compartment();
const guttersCompartment = new Compartment();
const modeAttrCompartment = new Compartment();

let view: EditorView | null = null;
let currentTheme: EditorTheme = "light";
let currentFontSize = 14;
let currentMode: EditorMode = "live";
let removeImageDoubleClickListener: (() => void) | null = null;
let removeTableCellListeners: (() => void) | null = null;
let tableContextMenu: TableContextMenu | null = null;
let tableContextPosition: number | null = null;
let activeTableCell: TableCellEditTarget | null = null;
const editorChannel =
  new URL(window.location.href).searchParams.get("channel") || "";

function bindImageDoubleClick(host: HTMLElement) {
  removeImageDoubleClickListener?.();
  imageDebug("listener-bound", { hostID: host.id });
  let traceUntil = 0;
  let lastImageFrom: string | undefined;
  const onPointerEvent = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const image = target?.closest?.(".zmd-lp-image") as HTMLElement | null;
    if (image) {
      traceUntil = Date.now() + 900;
      lastImageFrom = image.dataset.zmdImageFrom;
    } else if (Date.now() > traceUntil) {
      return;
    }
    imageDebug(`dom-${event.type}`, {
      detail: event.detail,
      target: target?.tagName,
      matchedImage: !!image,
      sourceFrom: image?.dataset.zmdImageFrom || lastImageFrom,
      className: image?.className,
    });
  };
  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const image = target?.closest?.(".zmd-lp-image") as HTMLElement | null;
    if (!image || !view) {
      imageDebug("dblclick-not-handled", {
        hasImage: !!image,
        hasView: !!view,
        target: target?.tagName,
      });
      return;
    }
    const pos = Number(image.dataset.zmdImageFrom);
    if (!Number.isFinite(pos)) {
      imageDebug("dblclick-invalid-position", {
        sourceFrom: image.dataset.zmdImageFrom,
      });
      return;
    }
    const line = view.state.doc.lineAt(pos);
    imageDebug("dblclick-dispatch", {
      pos,
      line: line.number,
      beforeHead: view.state.selection.main.head,
    });
    view.dispatch({ selection: { anchor: line.from } });
    view.focus();
    imageDebug("dblclick-complete", {
      afterHead: view.state.selection.main.head,
      activeLine: view.state.doc.lineAt(view.state.selection.main.head).number,
    });
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener("mousedown", onPointerEvent, true);
  host.addEventListener("pointerdown", onPointerEvent, true);
  host.addEventListener("click", onPointerEvent, true);
  host.addEventListener("dblclick", onPointerEvent, true);
  host.addEventListener("dblclick", onDoubleClick, true);
  removeImageDoubleClickListener = () => {
    host.removeEventListener("mousedown", onPointerEvent, true);
    host.removeEventListener("pointerdown", onPointerEvent, true);
    host.removeEventListener("click", onPointerEvent, true);
    host.removeEventListener("dblclick", onPointerEvent, true);
    host.removeEventListener("dblclick", onDoubleClick, true);
    removeImageDoubleClickListener = null;
  };
}

function dispatchActiveTableCell(target: TableCellEditTarget | null) {
  activeTableCell = target;
  view?.dispatch({ effects: setLiveTableCellEdit.of(target) });
}

function caretOffsetFromPoint(
  cell: HTMLElement,
  x: number,
  y: number,
  sourceLength: number,
) {
  const caret = cell.ownerDocument.caretPositionFromPoint?.(x, y);
  if (!caret?.offsetNode || !cell.contains(caret.offsetNode)) {
    return sourceLength;
  }
  const range = cell.ownerDocument.createRange();
  range.selectNodeContents(cell);
  range.setEnd(caret.offsetNode, caret.offset);
  const visibleLength = cell.textContent?.length || 0;
  if (!visibleLength) return 0;
  return Math.round((range.toString().length / visibleLength) * sourceLength);
}

function bindTableCellEditing(host: HTMLElement) {
  removeTableCellListeners?.();
  const onInput = (event: Event) => {
    if (!view || !activeTableCell || view.state.readOnly) return;
    const detail = (event as CustomEvent<TableCellInputDetail>).detail;
    const plan = planCellInput(
      view.state,
      activeTableCell,
      detail.value,
      detail.caretOffset,
    );
    if (!plan) {
      dispatchActiveTableCell(null);
      return;
    }
    activeTableCell = plan.active;
    view.dispatch({
      changes: plan.changes,
      effects: setLiveTableCellEdit.of(plan.active),
    });
  };
  const onCommit = () => dispatchActiveTableCell(null);
  const onNavigate = (event: Event) => {
    if (!view || !activeTableCell) return;
    const detail = (event as CustomEvent<TableCellNavigateDetail>).detail;
    const plan = planCellNavigation(
      view.state,
      activeTableCell,
      detail.backwards,
    );
    if (!plan) return;
    activeTableCell = plan.active;
    view.dispatch({
      changes: plan.changes,
      selection: { anchor: plan.active.from },
      effects: setLiveTableCellEdit.of(plan.active),
      scrollIntoView: true,
    });
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!activeTableCell) return;
    const target = event.target as Element | null;
    if (target?.closest?.(".zmd-lp-table-cell")) return;
    dispatchActiveTableCell(null);
  };
  host.addEventListener(TABLE_CELL_INPUT_EVENT, onInput);
  host.addEventListener(TABLE_CELL_COMMIT_EVENT, onCommit);
  host.addEventListener(TABLE_CELL_NAVIGATE_EVENT, onNavigate);
  document.addEventListener("pointerdown", onPointerDown, true);
  removeTableCellListeners = () => {
    host.removeEventListener(TABLE_CELL_INPUT_EVENT, onInput);
    host.removeEventListener(TABLE_CELL_COMMIT_EVENT, onCommit);
    host.removeEventListener(TABLE_CELL_NAVIGATE_EVENT, onNavigate);
    document.removeEventListener("pointerdown", onPointerDown, true);
    removeTableCellListeners = null;
  };
}

function postToParent(message: {
  type: "ready" | "change" | "save" | "error" | "pasteImage" | "imageDebug";
  payload?: unknown;
}) {
  window.parent?.postMessage(
    {
      source: EDITOR_MESSAGE_SOURCE,
      channel: editorChannel,
      ...message,
    },
    "*",
  );
}

function guttersForMode(mode: EditorMode): Extension {
  if (mode === "source") {
    return [lineNumbers(), highlightActiveLineGutter(), foldGutter()];
  }
  return [];
}

function modeUiForMode(mode: EditorMode): Extension {
  return EditorView.editorAttributes.of({
    class: mode === "live" ? "zmd-mode-live" : "zmd-mode-source",
  });
}

function buildExtensions(init: EditorInitPayload): Extension[] {
  currentTheme = init.theme;
  currentFontSize = init.fontSize;
  currentMode = init.mode === "source" ? "source" : "live";

  return [
    guttersCompartment.of(guttersForMode(currentMode)),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    history(),
    bracketMatching(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({ extensions: GFM }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...tableKeymap,
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
    themeCompartment.of(
      editorThemeExtension(init.theme, init.fontSize, currentMode),
    ),
    liveCompartment.of(livePreviewWhen(currentMode === "live")),
    modeAttrCompartment.of(modeUiForMode(currentMode)),
    readOnlyCompartment.of([
      EditorState.readOnly.of(!!init.readOnly),
      EditorView.editable.of(!init.readOnly),
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && activeTableCell) {
        const hasActiveEffect = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setLiveTableCellEdit)),
        );
        if (!hasActiveEffect) {
          activeTableCell = remapActiveCell(
            update.state,
            activeTableCell,
            update.changes.mapPos(activeTableCell.tableFrom, 1),
          );
        }
      }
      if (!update.docChanged) return;
      tableContextMenu?.close();
      const value = update.state.doc.toString();
      postToParent({
        type: "change",
        payload: { value, stats: computeStats(value) },
      });
    }),
    EditorView.domEventHandlers({
      contextmenu(event, editorView) {
        const target = event.target as Element | null;
        const liveCell = target?.closest?.(
          ".zmd-lp-table-cell",
        ) as HTMLElement | null;
        const widgetPosition = liveCell
          ? Number(liveCell.dataset.zmdTableCellFrom)
          : NaN;
        const position = Number.isFinite(widgetPosition)
          ? widgetPosition
          : editorView.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position == null) return false;
        const tableTarget = tableTargetAt(editorView.state, position);
        if (!tableTarget || !tableContextMenu) return false;
        tableContextPosition = position;
        tableContextMenu.open(
          event.clientX,
          event.clientY,
          tableMenuItems(tableTarget, editorView.state.readOnly),
        );
        event.preventDefault();
        return true;
      },
      click(event) {
        const target = event.target as Element | null;
        const cell = target?.closest?.(
          ".zmd-lp-table-cell",
        ) as HTMLElement | null;
        if (!cell || !view) return false;
        const from = Number(cell.dataset.zmdTableCellFrom);
        const to = Number(cell.dataset.zmdTableCellTo);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
        const valueLength = Math.max(0, to - from);
        const editTarget = activateTableCell(
          view.state,
          from,
          caretOffsetFromPoint(cell, event.clientX, event.clientY, valueLength),
        );
        if (!editTarget) return false;
        dispatchActiveTableCell(editTarget);
        event.preventDefault();
        return true;
      },
      dblclick(event) {
        const target = event.target as Element | null;
        const image = target?.closest?.(".zmd-lp-image") as HTMLElement | null;
        if (!image || !view) return false;
        const raw = image.dataset.zmdImageFrom;
        const pos = raw == null ? NaN : Number(raw);
        if (!Number.isFinite(pos)) return false;
        const line = view.state.doc.lineAt(pos);
        view.dispatch({ selection: { anchor: line.from } });
        view.focus();
        event.preventDefault();
        return true;
      },
      paste(event) {
        const file = [...(event.clipboardData?.files || [])].find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        if (!file) return false;
        event.preventDefault();
        void file.arrayBuffer().then(
          (bytes) => {
            postToParent({
              type: "pasteImage",
              payload: {
                bytes,
                mimeType: file.type,
                name: file.name || "image",
              },
            });
          },
          (error) => {
            postToParent({
              type: "error",
              payload: { message: String(error) },
            });
          },
        );
        return true;
      },
      drop(event) {
        const file = [...(event.dataTransfer?.files || [])].find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        if (!file) return false;
        event.preventDefault();
        void file.arrayBuffer().then(
          (bytes) => {
            postToParent({
              type: "pasteImage",
              payload: {
                bytes,
                mimeType: file.type,
                name: file.name || "image",
              },
            });
          },
          (error) =>
            postToParent({
              type: "error",
              payload: { message: String(error) },
            }),
        );
        return true;
      },
    }),
  ];
}

function applyMode(mode: EditorMode) {
  if (!view) return;
  currentMode = mode === "source" ? "source" : "live";
  view.dispatch({
    effects: [
      liveCompartment.reconfigure(livePreviewWhen(currentMode === "live")),
      guttersCompartment.reconfigure(guttersForMode(currentMode)),
      modeAttrCompartment.reconfigure(modeUiForMode(currentMode)),
      themeCompartment.reconfigure(
        editorThemeExtension(currentTheme, currentFontSize, currentMode),
      ),
    ],
  });
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

function insertTextInView(
  v: EditorView,
  text: string,
  selectionFrom = text.length,
  selectionTo = selectionFrom,
) {
  const { from, to } = v.state.selection.main;
  v.dispatch({
    changes: { from, to, insert: text },
    selection: {
      anchor: from + selectionFrom,
      head: from + selectionTo,
    },
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
    removeImageDoubleClickListener?.();
    removeTableCellListeners?.();
    activeTableCell = null;
    tableContextMenu?.destroy();
    tableContextMenu = null;
    tableContextPosition = null;
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
  tableContextMenu = createTableContextMenu({
    document,
    parent: view.dom,
    onAction: (action: TableAction) => {
      if (!view || tableContextPosition == null || view.state.readOnly) return;
      const target = tableTargetAt(view.state, tableContextPosition);
      if (!target) return;
      const plan = planTableOperation(view.state, target, action);
      if (!plan) return;
      const nextState = view.state.update({ changes: plan.changes }).state;
      const nextActive = activeTableCell
        ? remapActiveCell(nextState, plan.target)
        : null;
      activeTableCell = nextActive;
      view.dispatch({
        changes: plan.changes,
        selection: plan.selection,
        effects: setLiveTableCellEdit.of(nextActive),
        scrollIntoView: true,
      });
      view.focus();
    },
  });
  bindImageDoubleClick(host);
  bindTableCellEditing(host);
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
    case "replaceRange": {
      if (!view) return;
      view.dispatch({ changes: data.payload });
      break;
    }
    case "insertText": {
      if (!view) return;
      insertTextInView(
        view,
        data.payload.text,
        data.payload.selectionFrom,
        data.payload.selectionTo,
      );
      break;
    }
    case "command": {
      if (!view) return;
      if (data.payload.command === "find") openSearchPanel(view);
      else (data.payload.command === "undo" ? undo : redo)(view);
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
          editorThemeExtension(currentTheme, currentFontSize, currentMode),
        ),
      });
      break;
    }
    case "setFontSize": {
      if (!view) return;
      currentFontSize = data.payload.fontSize;
      view.dispatch({
        effects: themeCompartment.reconfigure(
          editorThemeExtension(currentTheme, currentFontSize, currentMode),
        ),
      });
      break;
    }
    case "setReadOnly": {
      if (!view) return;
      const readOnly = !!data.payload.readOnly;
      if (readOnly) activeTableCell = null;
      view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          setLiveTableCellEdit.of(activeTableCell),
        ],
      });
      break;
    }
    case "setMode": {
      dispatchActiveTableCell(null);
      applyMode(data.payload.mode === "source" ? "source" : "live");
      break;
    }
    case "setImageAssets": {
      if (!view) return;
      view.dispatch({ effects: setLiveImageAssets.of(data.payload.assets) });
      break;
    }
    case "destroy": {
      removeImageDoubleClickListener?.();
      removeTableCellListeners?.();
      activeTableCell = null;
      tableContextMenu?.destroy();
      tableContextMenu = null;
      tableContextPosition = null;
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
  "replaceRange",
  "insertText",
  "command",
  "wrapSelection",
  "prefixLine",
  "focus",
  "requestMeasure",
  "setTheme",
  "setFontSize",
  "setReadOnly",
  "setMode",
  "setImageAssets",
  "destroy",
]);

function onWindowMessage(event: MessageEvent) {
  if (!isEditorProtocolMessage(event.data)) return;
  if (!PARENT_TO_EDITOR_TYPES.has(event.data.type)) return;
  if (event.data.channel !== editorChannel) return;
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
  postToParent({ type: "ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
