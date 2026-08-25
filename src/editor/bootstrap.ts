/**
 * iframe-side entry: runs CodeMirror 6 inside a clean Web document.
 * Communicates with the parent Zotero tab via postMessage.
 *
 * This file is bundled into chrome://.../editor/editor.js and runs in a
 * real browser document (not the Zotero plugin sandbox). DOM types apply.
 */
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import {
  Annotation,
  EditorState,
  Compartment,
  Prec,
  type Extension,
} from "@codemirror/state";
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
import { bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from "@codemirror/search";
import {
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  computeStats,
  isEditorProtocolMessage,
  type EditorDocChange,
  type EditorInitPayload,
  type EditorMode,
  type EditorOutlineItem,
  type EditorSurface,
  type ImageAssetMap,
  type EditorTheme,
  type ParentToEditorMessage,
} from "../modules/markdown/editor-protocol";
import {
  activeOutlineID,
  clampOutlinePosition,
  extractEditorOutline,
} from "./outline";
import { codeSyntaxHighlighting, editorThemeExtension } from "./theme";
import { resolveCodeMirrorLanguage } from "./code-languages";
import { imageDebug } from "./image-debug";
import { MAX_IMAGE_BYTES } from "../modules/markdown/images/model";
import {
  livePreviewWhen,
  setLiveImageAssets,
  setLiveTableCellEdit,
  setLiveTableSelection,
} from "./live-preview";
import { forgetLiveAsset, rememberLiveAsset } from "./live-preview/assets";
import { tableKeymap } from "./table";
import {
  activateTableCellByIndex,
  interpretCellKey,
  isInsideSelector,
  planCellInput,
  planCellNavigation,
  remapActiveCell,
  TABLE_CELL_ACTIVATE_EVENT,
  TABLE_CELL_COMMIT_EVENT,
  TABLE_CELL_INPUT_EVENT,
  TABLE_CELL_NAVIGATE_EVENT,
  type TableCellActivateDetail,
  type TableCellEditTarget,
  type TableCellInputDetail,
  type TableCellNavigateDetail,
} from "./table-cell-edit";
import {
  isTableHandleClick,
  remapTableSelection,
  sameTableSelection,
  type TableSelection,
} from "./table-selection";
import {
  planTableEdgeAction,
  TABLE_EDGE_ACTION_EVENT,
  type TableEdgeActionDetail,
} from "./table-edge-actions";
import {
  planTableMoveColumnTo,
  planTableMoveRowTo,
  planTableOperation,
  planTableSelectionOperation,
  tableTargetAt,
  type TableAction,
  type TableSelectionAction,
} from "./table-operations";
import {
  createTableContextMenu,
  tableMenuItems,
  type TableContextMenu,
  type TableMenuAction,
} from "./table-menu";

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const editorEditableCompartment = new Compartment();
const liveCompartment = new Compartment();
const guttersCompartment = new Compartment();
const modeAttrCompartment = new Compartment();

const fromParentAnnotation = Annotation.define<boolean>();

type TableDragKind = "row" | "column";

interface TableDragSession {
  kind: TableDragKind;
  tableFrom: number;
  fromIndex: number;
  targetIndex: number;
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  moved: boolean;
}

interface EditorRuntime {
  view: EditorView | null;
  theme: EditorTheme;
  fontSize: number;
  mode: EditorMode;
  surface: EditorSurface;
  docRev: number;
  imageAssets: ImageAssetMap;
  removeImageDoubleClickListener: (() => void) | null;
  removeTableCellListeners: (() => void) | null;
  tableContextMenu: TableContextMenu | null;
  tableContextPosition: number | null;
  tableContextSelection: TableSelection;
  activeTableCell: TableCellEditTarget | null;
  tableDragSession: TableDragSession | null;
  tableSelection: TableSelection;
  outlineItems: EditorOutlineItem[];
  outlineTimer: number | null;
  activeOutlineID: string | null;
}

const runtime: EditorRuntime = {
  view: null,
  theme: "light",
  fontSize: 14,
  mode: "live",
  surface: "default",
  docRev: 0,
  imageAssets: {},
  removeImageDoubleClickListener: null,
  removeTableCellListeners: null,
  tableContextMenu: null,
  tableContextPosition: null,
  tableContextSelection: null,
  activeTableCell: null,
  tableDragSession: null,
  tableSelection: null,
  outlineItems: [],
  outlineTimer: null,
  activeOutlineID: null,
};

const editorChannel =
  new URL(window.location.href).searchParams.get("channel") || "";

function editorDebug(event: string, details?: unknown) {
  const message = `[Bamboo][EditorDebug] ${event}`;
  try {
    console.log(message, details ?? "");
  } catch {
    // ignore console failures in chrome documents
  }
}

function activateImageLine(image: HTMLElement) {
  const editor = runtime.view;
  if (!editor) return false;
  const pos = Number(image.dataset.zmdImageFrom);
  if (!Number.isFinite(pos)) return false;
  const line = editor.state.doc.lineAt(pos);
  editor.dispatch({ selection: { anchor: line.from } });
  editor.focus();
  return true;
}

function bindImageDoubleClick(host: HTMLElement) {
  runtime.removeImageDoubleClickListener?.();
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
    if (!image || !activateImageLine(image)) {
      imageDebug("dblclick-not-handled", {
        hasImage: !!image,
        hasView: !!runtime.view,
        target: target?.tagName,
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener("mousedown", onPointerEvent, true);
  host.addEventListener("pointerdown", onPointerEvent, true);
  host.addEventListener("click", onPointerEvent, true);
  host.addEventListener("dblclick", onPointerEvent, true);
  host.addEventListener("dblclick", onDoubleClick, true);
  runtime.removeImageDoubleClickListener = () => {
    host.removeEventListener("mousedown", onPointerEvent, true);
    host.removeEventListener("pointerdown", onPointerEvent, true);
    host.removeEventListener("click", onPointerEvent, true);
    host.removeEventListener("dblclick", onPointerEvent, true);
    host.removeEventListener("dblclick", onDoubleClick, true);
    runtime.removeImageDoubleClickListener = null;
  };
}

function editorEditableEffect() {
  const editable = !runtime.view?.state.readOnly && !runtime.activeTableCell;
  return editorEditableCompartment.reconfigure(
    EditorView.editable.of(editable),
  );
}

function dispatchActiveTableCell(target: TableCellEditTarget | null) {
  runtime.activeTableCell = target;
  runtime.view?.dispatch({
    effects: [setLiveTableCellEdit.of(target), editorEditableEffect()],
  });
}

function setTableSelection(selection: TableSelection) {
  if (sameTableSelection(runtime.tableSelection, selection)) return;
  runtime.tableSelection = selection;
  runtime.tableContextSelection = null;
  runtime.tableContextMenu?.close();
  runtime.activeTableCell = null;
  runtime.view?.dispatch({
    effects: [
      setLiveTableSelection.of(selection),
      setLiveTableCellEdit.of(null),
      editorEditableEffect(),
    ],
  });
}

function selectionContainsTableTarget(
  selection: TableSelection,
  target: {
    tableFrom: number;
    rowIndex: number;
    columnIndex: number;
  },
) {
  if (!selection || selection.tableFrom !== target.tableFrom) return false;
  return selection.kind === "row"
    ? selection.rowIndex === target.rowIndex
    : selection.columnIndex === target.columnIndex;
}

function supportsClipboardCommand(command: "copy" | "cut" | "paste"): boolean {
  try {
    return document.queryCommandSupported?.(command) !== false;
  } catch {
    return true;
  }
}

function runTableClipboardCommand(command: "copy" | "cut" | "paste") {
  const view = runtime.view;
  if (!view) return false;
  view.focus();
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

function syncEditingCellDom(value: string, caretOffset: number) {
  const cell = runtime.view?.dom.querySelector(
    ".zmd-lp-table-cell-editing",
  ) as HTMLElement | null;
  if (!cell) return;
  if ((cell.textContent || "") !== value) cell.textContent = value;
  const selection = cell.ownerDocument.getSelection();
  const node = cell.firstChild || cell;
  const offset = Math.min(
    caretOffset,
    node.nodeType === 3 ? node.textContent?.length || 0 : 0,
  );
  const range = cell.ownerDocument.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function applyActiveCellKey(event: KeyboardEvent): boolean {
  const view = runtime.view;
  const active = runtime.activeTableCell;
  if (!view || !active) return false;
  const intent = interpretCellKey(active.value, active.caretOffset, event.key, {
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    composing: event.isComposing,
  });
  if (intent.kind === "pass") return false;
  if (intent.kind === "commit") {
    dispatchActiveTableCell(null);
    return true;
  }
  if (intent.kind === "navigate") {
    const plan = planCellNavigation(view.state, active, intent.backwards);
    if (!plan) return true;
    runtime.activeTableCell = plan.active;
    view.dispatch({
      changes: plan.changes,
      selection: { anchor: plan.active.from },
      effects: [setLiveTableCellEdit.of(plan.active), editorEditableEffect()],
      scrollIntoView: true,
    });
    return true;
  }
  if (intent.kind === "caret") {
    const next = { ...active, caretOffset: intent.caretOffset };
    runtime.activeTableCell = next;
    view.dispatch({ effects: setLiveTableCellEdit.of(next) });
    syncEditingCellDom(next.value, next.caretOffset);
    return true;
  }
  const plan = planCellInput(
    view.state,
    active,
    intent.value,
    intent.caretOffset,
  );
  if (!plan) {
    dispatchActiveTableCell(null);
    return true;
  }
  runtime.activeTableCell = plan.active;
  view.dispatch({
    changes: plan.changes,
    effects: setLiveTableCellEdit.of(plan.active),
  });
  syncEditingCellDom(plan.active.value, plan.active.caretOffset);
  return true;
}

function applyTableSelectionDelete(): boolean {
  const view = runtime.view;
  const selection = runtime.tableSelection;
  if (!view || !selection) return false;
  if (view.state.readOnly) return true;
  const plan = planTableSelectionOperation(
    view.state,
    selection,
    "delete-selection",
  );
  if (!plan) return true;
  runtime.tableSelection = plan.nextTableSelection;
  runtime.tableContextSelection = null;
  runtime.activeTableCell = null;
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    effects: [
      setLiveTableSelection.of(plan.nextTableSelection),
      setLiveTableCellEdit.of(null),
      editorEditableEffect(),
    ],
    scrollIntoView: true,
  });
  return true;
}

function activateLiveTableCell(event: Event) {
  if (!runtime.view || runtime.view.state.readOnly) return;
  const detail = (event as CustomEvent<TableCellActivateDetail>).detail;
  const editTarget = activateTableCellByIndex(
    runtime.view.state,
    detail.tableFrom,
    detail.rowIndex,
    detail.columnIndex,
    detail.caretOffset,
  );
  if (!editTarget) return;
  if (
    runtime.activeTableCell &&
    runtime.activeTableCell.tableFrom === editTarget.tableFrom &&
    runtime.activeTableCell.rowIndex === editTarget.rowIndex &&
    runtime.activeTableCell.columnIndex === editTarget.columnIndex
  ) {
    return;
  }
  dispatchActiveTableCell(editTarget);
}

function tableDragTargetAtPoint(
  x: number,
  y: number,
  session: TableDragSession,
): number | null {
  const target = document.elementFromPoint(x, y);
  if (!target) return null;
  const line = target.closest(
    `.cm-line.zmd-lp-table-row[data-zmd-table-from="${session.tableFrom}"]`,
  ) as HTMLElement | null;
  if (!line) return null;
  if (session.kind === "row") {
    const rowIndex = Number(line.dataset.zmdTableRowIndex);
    return Number.isInteger(rowIndex) && rowIndex >= 1 ? rowIndex : null;
  }
  const handle = target.closest(
    `.zmd-lp-table-column-handle[data-zmd-table-from="${session.tableFrom}"]`,
  ) as HTMLElement | null;
  if (handle) {
    const columnIndex = Number(handle.dataset.zmdTableColumn);
    return Number.isInteger(columnIndex) ? columnIndex : null;
  }
  const cell = target.closest(".zmd-lp-table-cell") as HTMLElement | null;
  if (!cell) return null;
  const columnIndex = Number(cell.dataset.zmdTableCellColumn);
  return Number.isInteger(columnIndex) ? columnIndex : null;
}

function clearTableDragHighlight() {
  for (const element of document.querySelectorAll<HTMLElement>(
    ".zmd-lp-table-drag-source, .zmd-lp-table-drop-target",
  )) {
    element.classList.remove(
      "zmd-lp-table-drag-source",
      "zmd-lp-table-drop-target",
    );
  }
}

function applyTableDragHighlight(session: TableDragSession) {
  clearTableDragHighlight();
  const lines = document.querySelectorAll<HTMLElement>(
    `.cm-line.zmd-lp-table-row[data-zmd-table-from="${session.tableFrom}"]`,
  );
  for (const line of lines) {
    const rowIndex = Number(line.dataset.zmdTableRowIndex);
    const rowSource = session.kind === "row" && rowIndex === session.fromIndex;
    const rowTarget =
      session.kind === "row" &&
      session.targetIndex !== session.fromIndex &&
      rowIndex === session.targetIndex;
    if (rowSource) line.classList.add("zmd-lp-table-drag-source");
    if (rowTarget) line.classList.add("zmd-lp-table-drop-target");
    for (const cell of line.querySelectorAll<HTMLElement>(
      ".zmd-lp-table-cell",
    )) {
      const columnIndex = Number(cell.dataset.zmdTableCellColumn);
      const columnSource =
        session.kind === "column" && columnIndex === session.fromIndex;
      const columnTarget =
        session.kind === "column" &&
        session.targetIndex !== session.fromIndex &&
        columnIndex === session.targetIndex;
      if (rowSource || columnSource) {
        cell.classList.add("zmd-lp-table-drag-source");
      } else if (rowTarget || columnTarget) {
        cell.classList.add("zmd-lp-table-drop-target");
      }
    }
  }
}

function onTableDragMove(event: PointerEvent) {
  const session = runtime.tableDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  if (!session.moved) {
    if (
      isTableHandleClick(
        session.startX,
        session.startY,
        event.clientX,
        event.clientY,
      )
    ) {
      return;
    }
    session.moved = true;
    applyTableDragHighlight(session);
  }
  const targetIndex = tableDragTargetAtPoint(
    event.clientX,
    event.clientY,
    session,
  );
  if (targetIndex == null || targetIndex === session.targetIndex) return;
  session.targetIndex = targetIndex;
  applyTableDragHighlight(session);
}

function onTableDragEnd(event: PointerEvent) {
  const session = runtime.tableDragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  document.removeEventListener("pointermove", onTableDragMove);
  document.removeEventListener("pointerup", onTableDragEnd);
  document.removeEventListener("pointercancel", onTableDragEnd);
  try {
    session.handle.releasePointerCapture?.(session.pointerId);
  } catch {
    // ignore
  }
  runtime.tableDragSession = null;
  clearTableDragHighlight();

  if (event.type === "pointercancel" || !runtime.view) return;
  if (!session.moved) {
    setTableSelection(
      session.kind === "row"
        ? {
            kind: "row",
            tableFrom: session.tableFrom,
            rowIndex: session.fromIndex,
          }
        : {
            kind: "column",
            tableFrom: session.tableFrom,
            columnIndex: session.fromIndex,
          },
    );
    return;
  }
  const targetIndex = tableDragTargetAtPoint(
    event.clientX,
    event.clientY,
    session,
  );
  if (targetIndex == null) return;
  if (targetIndex === session.fromIndex) {
    setTableSelection(
      session.kind === "row"
        ? {
            kind: "row",
            tableFrom: session.tableFrom,
            rowIndex: session.fromIndex,
          }
        : {
            kind: "column",
            tableFrom: session.tableFrom,
            columnIndex: session.fromIndex,
          },
    );
    return;
  }
  const plan =
    session.kind === "row"
      ? planTableMoveRowTo(
          runtime.view.state,
          session.tableFrom,
          session.fromIndex,
          targetIndex,
        )
      : planTableMoveColumnTo(
          runtime.view.state,
          session.tableFrom,
          session.fromIndex,
          targetIndex,
        );
  if (!plan) return;
  const selection: TableSelection =
    session.kind === "row"
      ? {
          kind: "row",
          tableFrom: session.tableFrom,
          rowIndex: targetIndex,
        }
      : {
          kind: "column",
          tableFrom: session.tableFrom,
          columnIndex: targetIndex,
        };
  runtime.tableSelection = selection;
  runtime.activeTableCell = null;
  runtime.view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    effects: [
      setLiveTableCellEdit.of(null),
      setLiveTableSelection.of(selection),
      editorEditableEffect(),
    ],
    scrollIntoView: true,
  });
}

function cancelTableDrag() {
  if (!runtime.tableDragSession) return;
  document.removeEventListener("pointermove", onTableDragMove);
  document.removeEventListener("pointerup", onTableDragEnd);
  document.removeEventListener("pointercancel", onTableDragEnd);
  runtime.tableDragSession = null;
  clearTableDragHighlight();
}

function startTableDrag(event: PointerEvent): boolean {
  const target = event.target as Element | null;
  const handle = target?.closest?.(
    "[data-zmd-table-drag]",
  ) as HTMLElement | null;
  if (!handle || !runtime.view || runtime.view.state.readOnly) return false;
  const kind = handle.dataset.zmdTableDrag as TableDragKind | undefined;
  if (kind !== "row" && kind !== "column") return false;
  const tableFrom = Number(handle.dataset.zmdTableFrom);
  const fromIndex = Number(
    kind === "row" ? handle.dataset.zmdTableRow : handle.dataset.zmdTableColumn,
  );
  if (!Number.isInteger(tableFrom) || !Number.isInteger(fromIndex))
    return false;
  if (kind === "row" && fromIndex < 1) return false;

  const session: TableDragSession = {
    kind,
    tableFrom,
    fromIndex,
    targetIndex: fromIndex,
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  runtime.tableDragSession = session;
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch {
    // ignore
  }
  document.addEventListener("pointermove", onTableDragMove);
  document.addEventListener("pointerup", onTableDragEnd);
  document.addEventListener("pointercancel", onTableDragEnd);
  event.preventDefault();
  return true;
}

function bindTableCellEditing(host: HTMLElement) {
  runtime.removeTableCellListeners?.();
  const onInput = (event: Event) => {
    if (
      !runtime.view ||
      !runtime.activeTableCell ||
      runtime.view.state.readOnly
    )
      return;
    const detail = (event as CustomEvent<TableCellInputDetail>).detail;
    const plan = planCellInput(
      runtime.view.state,
      runtime.activeTableCell,
      detail.value,
      detail.caretOffset,
    );
    if (!plan) {
      dispatchActiveTableCell(null);
      return;
    }
    runtime.activeTableCell = plan.active;
    runtime.view.dispatch({
      changes: plan.changes,
      effects: setLiveTableCellEdit.of(plan.active),
    });
  };
  const onCommit = () => dispatchActiveTableCell(null);
  const onNavigate = (event: Event) => {
    if (!runtime.view || !runtime.activeTableCell) return;
    const detail = (event as CustomEvent<TableCellNavigateDetail>).detail;
    const plan = planCellNavigation(
      runtime.view.state,
      runtime.activeTableCell,
      detail.backwards,
    );
    if (!plan) return;
    runtime.activeTableCell = plan.active;
    runtime.view.dispatch({
      changes: plan.changes,
      selection: { anchor: plan.active.from },
      effects: setLiveTableCellEdit.of(plan.active),
      scrollIntoView: true,
    });
  };
  const onEdgeAction = (event: Event) => {
    if (!runtime.view || runtime.view.state.readOnly) return;
    const detail = (event as CustomEvent<TableEdgeActionDetail>).detail;
    const plan = planTableEdgeAction(
      runtime.view.state,
      detail.position,
      detail.action,
    );
    if (!plan) return;
    const nextState = runtime.view.state.update({
      changes: plan.changes,
    }).state;
    const nextActive = remapActiveCell(nextState, plan.target);
    runtime.activeTableCell = nextActive;
    runtime.view.dispatch({
      changes: plan.changes,
      selection: plan.selection,
      effects: setLiveTableCellEdit.of(nextActive),
      scrollIntoView: true,
    });
  };
  const onPointerDown = (event: PointerEvent) => {
    if (isInsideSelector(event, "[data-zmd-table-drag]")) return;
    if (isInsideSelector(event, ".zmd-lp-table-edge-action")) return;
    if (isInsideSelector(event, ".zmd-table-context-menu")) return;
    const insideCell = isInsideSelector(event, ".zmd-lp-table-cell");
    if (runtime.tableSelection) setTableSelection(null);
    if (insideCell) return;
    if (!runtime.activeTableCell) return;
    dispatchActiveTableCell(null);
  };
  const onDragHandlePointerDown = (event: PointerEvent) => {
    startTableDrag(event);
  };
  host.addEventListener(TABLE_CELL_ACTIVATE_EVENT, activateLiveTableCell);
  host.addEventListener(TABLE_CELL_INPUT_EVENT, onInput);
  host.addEventListener(TABLE_CELL_COMMIT_EVENT, onCommit);
  host.addEventListener(TABLE_CELL_NAVIGATE_EVENT, onNavigate);
  host.addEventListener(TABLE_EDGE_ACTION_EVENT, onEdgeAction);
  host.addEventListener("pointerdown", onDragHandlePointerDown);
  document.addEventListener("pointerdown", onPointerDown, true);
  runtime.removeTableCellListeners = () => {
    host.removeEventListener(TABLE_CELL_ACTIVATE_EVENT, activateLiveTableCell);
    host.removeEventListener(TABLE_CELL_INPUT_EVENT, onInput);
    host.removeEventListener(TABLE_CELL_COMMIT_EVENT, onCommit);
    host.removeEventListener(TABLE_CELL_NAVIGATE_EVENT, onNavigate);
    host.removeEventListener(TABLE_EDGE_ACTION_EVENT, onEdgeAction);
    host.removeEventListener("pointerdown", onDragHandlePointerDown);
    document.removeEventListener("pointerdown", onPointerDown, true);
    runtime.removeTableCellListeners = null;
  };
}

function forwardImageFile(files: File[], event: Event) {
  const file = files.find((candidate) => candidate.type.startsWith("image/"));
  if (!file) return false;
  event.preventDefault();
  if (file.size > MAX_IMAGE_BYTES) {
    postToParent({
      type: "error",
      payload: { message: "图片不能超过 15 MB" },
    });
    return true;
  }
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
}

function postToParent(message: {
  type:
    | "ready"
    | "outline"
    | "outlineActive"
    | "change"
    | "snapshot"
    | "resolveAsset"
    | "save"
    | "error"
    | "pasteImage"
    | "imageDebug";
  payload?: unknown;
}) {
  window.parent?.postMessage(
    {
      source: EDITOR_MESSAGE_SOURCE,
      channel: editorChannel,
      v: EDITOR_PROTOCOL_VERSION,
      ...message,
    },
    "*",
  );
}

function publishOutline(view: EditorView) {
  runtime.outlineTimer = null;
  const items = extractEditorOutline(view.state);
  const activeID = activeOutlineID(items, view.state.selection.main.head);
  runtime.outlineItems = items;
  runtime.activeOutlineID = activeID;
  postToParent({ type: "outline", payload: { items, activeID } });
}

function scheduleOutlineUpdate(view: EditorView, immediate = false) {
  if (runtime.outlineTimer != null) {
    window.clearTimeout(runtime.outlineTimer);
  }
  if (immediate) {
    publishOutline(view);
    return;
  }
  runtime.outlineTimer = window.setTimeout(() => publishOutline(view), 100);
}

function publishActiveOutline(view: EditorView) {
  const activeID = activeOutlineID(
    runtime.outlineItems,
    view.state.selection.main.head,
  );
  if (activeID === runtime.activeOutlineID) return;
  runtime.activeOutlineID = activeID;
  postToParent({ type: "outlineActive", payload: { activeID } });
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

function buildExtensions(
  init: EditorInitPayload,
  disableLivePreview = false,
): Extension[] {
  runtime.theme = init.theme;
  runtime.fontSize = init.fontSize;
  runtime.mode = init.mode === "source" ? "source" : "live";
  runtime.surface = init.surface === "sidebar" ? "sidebar" : "default";

  return [
    guttersCompartment.of(guttersForMode(runtime.mode)),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    history(),
    bracketMatching(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({
      extensions: GFM,
      codeLanguages: resolveCodeMirrorLanguage,
    }),
    Prec.highest(
      keymap.of([
        {
          any(_view, event) {
            if (
              runtime.tableSelection &&
              (event.key === "Delete" || event.key === "Backspace")
            ) {
              return applyTableSelectionDelete();
            }
            if (!runtime.activeTableCell) return false;
            if (isInsideSelector(event, ".zmd-lp-table-cell-editing")) {
              return false;
            }
            return applyActiveCellKey(event);
          },
        },
      ]),
    ),
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
    themeCompartment.of([
      editorThemeExtension(
        init.theme,
        init.fontSize,
        runtime.mode,
        runtime.surface,
      ),
      codeSyntaxHighlighting(init.theme),
    ]),
    liveCompartment.of(
      disableLivePreview ? [] : livePreviewWhen(runtime.mode === "live"),
    ),
    modeAttrCompartment.of(modeUiForMode(runtime.mode)),
    readOnlyCompartment.of(EditorState.readOnly.of(!!init.readOnly)),
    editorEditableCompartment.of(EditorView.editable.of(!init.readOnly)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && runtime.tableSelection) {
        const hasSelectionEffect = update.transactions.some((transaction) =>
          transaction.effects.some((effect) =>
            effect.is(setLiveTableSelection),
          ),
        );
        if (!hasSelectionEffect) {
          const nextSelection = remapTableSelection(
            update.state,
            runtime.tableSelection,
            update.changes,
          );
          if (!sameTableSelection(runtime.tableSelection, nextSelection)) {
            runtime.tableSelection = nextSelection;
            const view = update.view;
            queueMicrotask(() => {
              if (
                runtime.view === view &&
                sameTableSelection(runtime.tableSelection, nextSelection)
              ) {
                view.dispatch({
                  effects: setLiveTableSelection.of(nextSelection),
                });
              }
            });
          }
        }
      }
      if (update.docChanged && runtime.activeTableCell) {
        const hasActiveEffect = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setLiveTableCellEdit)),
        );
        if (!hasActiveEffect) {
          runtime.activeTableCell = remapActiveCell(
            update.state,
            runtime.activeTableCell,
            update.changes.mapPos(runtime.activeTableCell.tableFrom, 1),
          );
        }
      }
      if (update.selectionSet) publishActiveOutline(update.view);
      if (!update.docChanged) return;
      scheduleOutlineUpdate(update.view);
      if (
        update.transactions.some((transaction) =>
          transaction.annotation(fromParentAnnotation),
        )
      ) {
        return;
      }
      runtime.tableContextMenu?.close();
      runtime.docRev += 1;
      const changes: EditorDocChange[] = [];
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() });
      });
      postToParent({
        type: "change",
        payload: { rev: runtime.docRev, changes },
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
        if (!tableTarget || !runtime.tableContextMenu) return false;
        const selectedTarget = selectionContainsTableTarget(
          runtime.tableSelection,
          tableTarget,
        );
        if (runtime.tableSelection && !selectedTarget) {
          setTableSelection(null);
        }
        const contextSelection = selectedTarget ? runtime.tableSelection : null;
        runtime.tableContextPosition = position;
        runtime.tableContextSelection = contextSelection;
        runtime.tableContextMenu.open(
          event.clientX,
          event.clientY,
          tableMenuItems(
            tableTarget,
            editorView.state.readOnly,
            contextSelection,
            {
              copy: supportsClipboardCommand("copy"),
              cut: supportsClipboardCommand("cut"),
              paste: supportsClipboardCommand("paste"),
            },
          ),
        );
        event.preventDefault();
        return true;
      },
      dblclick(event) {
        const target = event.target as Element | null;
        const image = target?.closest?.(".zmd-lp-image") as HTMLElement | null;
        if (!image || !activateImageLine(image)) return false;
        event.preventDefault();
        return true;
      },
      paste(event) {
        return forwardImageFile([...(event.clipboardData?.files || [])], event);
      },
      drop(event) {
        return forwardImageFile([...(event.dataTransfer?.files || [])], event);
      },
    }),
  ];
}

function applyMode(mode: EditorMode) {
  if (!runtime.view) return;
  runtime.mode = mode === "source" ? "source" : "live";
  runtime.view.dispatch({
    effects: [
      liveCompartment.reconfigure(livePreviewWhen(runtime.mode === "live")),
      guttersCompartment.reconfigure(guttersForMode(runtime.mode)),
      modeAttrCompartment.reconfigure(modeUiForMode(runtime.mode)),
      themeCompartment.reconfigure([
        editorThemeExtension(
          runtime.theme,
          runtime.fontSize,
          runtime.mode,
          runtime.surface,
        ),
        codeSyntaxHighlighting(runtime.theme),
      ]),
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

function isTableSelectionAction(
  action: TableMenuAction,
): action is TableSelectionAction {
  return (
    action === "clear-selection" ||
    action === "delete-selection" ||
    action === "align-selection-default" ||
    action === "align-selection-left" ||
    action === "align-selection-center" ||
    action === "align-selection-right"
  );
}

function dispatchTableSelectionAction(
  selection: TableSelection,
  action: TableSelectionAction,
) {
  const view = runtime.view;
  if (!view || !selection || view.state.readOnly) return;
  const plan = planTableSelectionOperation(view.state, selection, action);
  if (!plan) return;
  runtime.tableSelection = plan.nextTableSelection;
  runtime.tableContextSelection = null;
  runtime.activeTableCell = null;
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    effects: [
      setLiveTableSelection.of(plan.nextTableSelection),
      setLiveTableCellEdit.of(null),
      editorEditableEffect(),
    ],
    scrollIntoView: true,
  });
  view.focus();
}

function createOrResetEditor(init: EditorInitPayload) {
  editorDebug("init-received", {
    channel: editorChannel,
    mode: init.mode,
    surface: init.surface,
    docLength: init.doc?.length ?? 0,
  });
  const host = document.getElementById("editor-root");
  if (!host) {
    postToParent({
      type: "error",
      payload: { message: "Missing #editor-root" },
    });
    return;
  }

  if (runtime.view) {
    if (runtime.outlineTimer != null) {
      window.clearTimeout(runtime.outlineTimer);
      runtime.outlineTimer = null;
    }
    runtime.removeImageDoubleClickListener?.();
    runtime.removeTableCellListeners?.();
    cancelTableDrag();
    runtime.activeTableCell = null;
    runtime.tableSelection = null;
    runtime.tableContextSelection = null;
    runtime.tableContextMenu?.destroy();
    runtime.tableContextMenu = null;
    runtime.tableContextPosition = null;
    runtime.view.destroy();
    runtime.view = null;
  }

  runtime.docRev = 0;
  runtime.imageAssets = {};
  runtime.tableSelection = null;
  runtime.tableContextSelection = null;
  let state: EditorState;
  try {
    editorDebug("state-create-start");
    state = EditorState.create({
      doc: init.doc ?? "",
      extensions: buildExtensions(init),
    });
    editorDebug("state-create-complete");
    runtime.view = new EditorView({ state, parent: host });
    editorDebug("view-create-complete", {
      mode: runtime.mode,
      docLength: runtime.view.state.doc.length,
    });
  } catch (error) {
    editorDebug("live-init-failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    runtime.view?.destroy();
    runtime.view = null;
    postToParent({
      type: "error",
      payload: {
        message: `Live Preview initialization failed; using Source mode: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    });
    const fallbackInit = { ...init, mode: "source" as const };
    runtime.mode = "source";
    state = EditorState.create({
      doc: fallbackInit.doc ?? "",
      extensions: buildExtensions(fallbackInit, true),
    });
    runtime.view = new EditorView({ state, parent: host });
    editorDebug("source-fallback-complete", {
      docLength: runtime.view.state.doc.length,
    });
  }
  runtime.tableContextMenu = createTableContextMenu({
    document,
    parent: runtime.view.dom,
    onAction: (action: TableMenuAction) => {
      if (!runtime.view) return;
      if (action === "copy" || action === "cut" || action === "paste") {
        runTableClipboardCommand(action);
        return;
      }
      if (isTableSelectionAction(action)) {
        dispatchTableSelectionAction(runtime.tableContextSelection, action);
        return;
      }
      if (runtime.tableContextPosition == null || runtime.view.state.readOnly)
        return;
      const target = tableTargetAt(
        runtime.view.state,
        runtime.tableContextPosition,
      );
      if (!target) return;
      const plan = planTableOperation(
        runtime.view.state,
        target,
        action as TableAction,
      );
      if (!plan) return;
      const nextState = runtime.view.state.update({
        changes: plan.changes,
      }).state;
      const nextActive = runtime.activeTableCell
        ? remapActiveCell(nextState, plan.target)
        : null;
      runtime.activeTableCell = nextActive;
      runtime.view.dispatch({
        changes: plan.changes,
        selection: plan.selection,
        effects: setLiveTableCellEdit.of(nextActive),
        scrollIntoView: true,
      });
      runtime.view.focus();
    },
  });
  bindImageDoubleClick(host);
  bindTableCellEditing(host);
  scheduleOutlineUpdate(runtime.view, true);
}

function handleParentMessage(data: ParentToEditorMessage) {
  editorDebug("parent-message", { type: data.type, channel: editorChannel });
  switch (data.type) {
    case "init":
      createOrResetEditor(data.payload);
      break;
    case "setValue": {
      if (!runtime.view) return;
      const value = data.payload.value;
      runtime.view.dispatch({
        changes: {
          from: 0,
          to: runtime.view.state.doc.length,
          insert: value,
        },
        annotations: fromParentAnnotation.of(true),
      });
      break;
    }
    case "replaceRange": {
      if (!runtime.view) return;
      // Clamp against the current document: the parent computes these
      // positions from its echoed mirror, which can lag the live buffer
      // during fast typing — an out-of-range dispatch would throw inside
      // CodeMirror and the title sync would fail silently.
      const docLength = runtime.view.state.doc.length;
      const from = data.payload.from;
      const to = data.payload.to;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      const safeFrom = Math.max(0, Math.min(Math.trunc(from), docLength));
      const safeTo = Math.max(safeFrom, Math.min(Math.trunc(to), docLength));
      runtime.view.dispatch({
        changes: { from: safeFrom, to: safeTo, insert: data.payload.insert },
      });
      break;
    }
    case "insertText": {
      if (!runtime.view) return;
      insertTextInView(
        runtime.view,
        data.payload.text,
        data.payload.selectionFrom,
        data.payload.selectionTo,
      );
      break;
    }
    case "command": {
      if (!runtime.view) return;
      if (data.payload.command === "find") openSearchPanel(runtime.view);
      else (data.payload.command === "undo" ? undo : redo)(runtime.view);
      break;
    }
    case "wrapSelection": {
      if (!runtime.view) return;
      wrapSelectionInView(
        runtime.view,
        data.payload.before,
        data.payload.after ?? data.payload.before,
      );
      break;
    }
    case "prefixLine": {
      if (!runtime.view) return;
      prefixLineInView(runtime.view, data.payload.prefix);
      break;
    }
    case "revealPosition": {
      if (!runtime.view) return;
      const position = clampOutlinePosition(
        data.payload.position,
        runtime.view.state.doc.length,
      );
      if (position == null) return;
      runtime.view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, {
          y: "start",
          yMargin: 24,
        }),
      });
      runtime.view.focus();
      break;
    }
    case "requestSnapshot": {
      if (!runtime.view) return;
      const value = runtime.view.state.doc.toString();
      postToParent({
        type: "snapshot",
        payload: {
          requestId: data.payload.requestId,
          rev: runtime.docRev,
          value,
          stats: computeStats(value),
        },
      });
      break;
    }
    case "focus":
      runtime.view?.focus();
      break;
    case "requestMeasure":
      runtime.view?.requestMeasure();
      break;
    case "setTheme": {
      if (!runtime.view) return;
      runtime.theme = data.payload.theme;
      runtime.view.dispatch({
        effects: themeCompartment.reconfigure([
          editorThemeExtension(
            runtime.theme,
            runtime.fontSize,
            runtime.mode,
            runtime.surface,
          ),
          codeSyntaxHighlighting(runtime.theme),
        ]),
      });
      break;
    }
    case "setFontSize": {
      if (!runtime.view) return;
      runtime.fontSize = data.payload.fontSize;
      runtime.view.dispatch({
        effects: themeCompartment.reconfigure([
          editorThemeExtension(
            runtime.theme,
            runtime.fontSize,
            runtime.mode,
            runtime.surface,
          ),
          codeSyntaxHighlighting(runtime.theme),
        ]),
      });
      break;
    }
    case "setReadOnly": {
      if (!runtime.view) return;
      const readOnly = !!data.payload.readOnly;
      if (readOnly) runtime.activeTableCell = null;
      runtime.view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
          editorEditableCompartment.reconfigure(
            EditorView.editable.of(!readOnly && !runtime.activeTableCell),
          ),
          setLiveTableCellEdit.of(runtime.activeTableCell),
        ],
      });
      break;
    }
    case "setMode": {
      setTableSelection(null);
      dispatchActiveTableCell(null);
      applyMode(data.payload.mode === "source" ? "source" : "live");
      break;
    }
    case "setImageAssets": {
      if (!runtime.view) return;
      // Full-set pushes (the parent sends the complete map for the current
      // document) replace the map so stale data URLs from removed references
      // do not accumulate; single-asset pushes (`replace: false`) merge.
      runtime.imageAssets = data.payload.replace
        ? { ...data.payload.assets }
        : { ...runtime.imageAssets, ...data.payload.assets };
      for (const reference of Object.keys(data.payload.assets)) {
        rememberLiveAsset(reference);
      }
      runtime.view.dispatch({
        effects: setLiveImageAssets.of(runtime.imageAssets),
      });
      break;
    }
    case "assetResolved": {
      if (!runtime.view) return;
      rememberLiveAsset(data.payload.reference);
      runtime.imageAssets = {
        ...runtime.imageAssets,
        [data.payload.reference]: {
          dataUrl: data.payload.dataUrl,
          error: data.payload.error,
        },
      };
      if (data.payload.error) {
        // Failed resolution: allow a later re-request (cooldown-bounded in
        // assets.ts) so the placeholder recovers once the file appears.
        forgetLiveAsset(data.payload.reference);
      }
      runtime.view.dispatch({
        effects: setLiveImageAssets.of(runtime.imageAssets),
      });
      break;
    }
    case "destroy": {
      if (runtime.outlineTimer != null) {
        window.clearTimeout(runtime.outlineTimer);
        runtime.outlineTimer = null;
      }
      runtime.outlineItems = [];
      runtime.activeOutlineID = null;
      runtime.removeImageDoubleClickListener?.();
      runtime.removeTableCellListeners?.();
      cancelTableDrag();
      runtime.activeTableCell = null;
      runtime.tableSelection = null;
      runtime.tableContextSelection = null;
      runtime.tableContextMenu?.destroy();
      runtime.tableContextMenu = null;
      runtime.tableContextPosition = null;
      runtime.view?.destroy();
      runtime.view = null;
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
  "revealPosition",
  "focus",
  "requestMeasure",
  "setTheme",
  "setFontSize",
  "setReadOnly",
  "setMode",
  "setImageAssets",
  "requestSnapshot",
  "assetResolved",
  "destroy",
]);

function onWindowMessage(event: MessageEvent) {
  editorDebug("message-received", {
    sourceIsParent: event.source === window.parent,
    sourceIsNull: event.source == null,
    type: (event.data as { type?: unknown } | null)?.type,
    channel: (event.data as { channel?: unknown } | null)?.channel,
  });
  // Only ever accept messages from the embedding parent window. Without this
  // check, any script running in the parent document context could forge
  // editor commands (setValue / destroy / ...) for a guessed channel.
  // In Zotero's privileged chrome iframe, MessageEvent.source can be null or
  // a wrapper that is not object-identical to window.parent. The channel and
  // protocol checks below remain mandatory, so accept those two valid cases.
  if (event.source != null && event.source !== window.parent) {
    editorDebug("message-rejected-source");
    return;
  }
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
  editorDebug("boot", {
    readyState: document.readyState,
    channel: editorChannel,
    hasRoot: !!document.getElementById("editor-root"),
  });
  window.addEventListener("message", onWindowMessage);
  postToParent({ type: "ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
