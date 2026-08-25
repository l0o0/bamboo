/// <reference lib="dom" />

import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  activeLinesFromSelection,
  frontmatterLineNumbersFromLines,
} from "./active-lines";
import { fencedCodeLineKindsFromLines, parseListPrefix } from "./structure";
import { parseInlineL2 } from "./inline";
import { requestLiveAsset } from "./assets";
import { cachedLineParse } from "./line-cache";
import type { DocLines, LineInfo } from "./types";
import { normalizeAssetReference } from "../../modules/markdown/images/model";
import type { ImageAssetMap } from "../../modules/markdown/editor-protocol";
import { imageDebug } from "../image-debug";
import {
  cellWidgetRange,
  liveTableRows,
  sameTableCellIdentity,
  type TableAlignment,
} from "../table";
import { selectionContainsCell, type TableSelection } from "../table-selection";
import {
  remapActiveCell,
  TABLE_CELL_ACTIVATE_EVENT,
  TABLE_CELL_COMMIT_EVENT,
  TABLE_CELL_INPUT_EVENT,
  TABLE_CELL_NAVIGATE_EVENT,
  type TableCellActivateDetail,
  type TableCellEditTarget,
} from "../table-cell-edit";
import {
  TABLE_EDGE_ACTION_EVENT,
  type TableEdgeAction,
  type TableEdgeActionDetail,
} from "../table-edge-actions";

export const setLiveImageAssets = StateEffect.define<ImageAssetMap>();
export const setLiveTableCellEdit =
  StateEffect.define<TableCellEditTarget | null>();
export const setLiveTableSelection = StateEffect.define<TableSelection>();

function asDocLines(state: EditorState): DocLines {
  return {
    lines: state.doc.lines,
    line: (n: number): LineInfo => {
      const l = state.doc.line(n);
      return { number: n, from: l.from, to: l.to, text: l.text };
    },
    lineAt: (pos: number): LineInfo => {
      const l = state.doc.lineAt(pos);
      return { number: l.number, from: l.from, to: l.to, text: l.text };
    },
  };
}

/**
 * Hide a source range from the view (inactive live lines).
 * Use Decoration.replace (not CSS width:0) so CodeMirror's posAtCoords
 * maps clicks to the correct document offset / line.
 */
function hideRange(from: number, to: number) {
  return Decoration.replace({}).range(from, to);
}

/** Muted visible syntax on the active (editing) line. */
function syntaxRange(from: number, to: number) {
  return Decoration.mark({ class: "zmd-lp-syntax" }).range(from, to);
}

/** Replaces a list prefix without losing its nesting indentation or label. */
class ListMarkerWidget extends WidgetType {
  constructor(
    readonly indent: string,
    readonly marker: string,
    readonly ordered: boolean,
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return (
      this.indent === other.indent &&
      this.marker === other.marker &&
      this.ordered === other.ordered
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "zmd-lp-list-marker";
    wrapper.textContent = `${this.indent}${this.ordered ? this.marker : "•"} `;
    return wrapper;
  }
}

function listMarkerRange(
  from: number,
  to: number,
  list: NonNullable<ReturnType<typeof parseListPrefix>>,
) {
  return Decoration.replace({
    widget: new ListMarkerWidget(list.indent, list.marker, list.ordered),
  }).range(from, to);
}

class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly source: string,
    readonly documentFrom: number,
    readonly dataUrl?: string,
    readonly error?: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return (
      this.alt === other.alt &&
      this.source === other.source &&
      this.documentFrom === other.documentFrom &&
      this.dataUrl === other.dataUrl &&
      this.error === other.error
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "zmd-lp-image";
    wrapper.dataset.zmdImageFrom = String(this.documentFrom);
    const displaySource =
      this.dataUrl || (/^https?:\/\//i.test(this.source) ? this.source : "");
    // Re-request on every render while the asset is unresolved: `assets.ts`
    // dedupes in-flight requests and cooldowns retries after failures.
    if (!this.dataUrl) requestLiveAsset(this.source);
    imageDebug("widget-render", {
      source: this.source,
      documentFrom: this.documentFrom,
      hasDataUrl: !!this.dataUrl,
      hasError: !!this.error,
    });
    if (displaySource) {
      const image = document.createElement("img");
      image.src = displaySource;
      image.alt = this.alt;
      image.loading = "lazy";
      // Remote images load inside a chrome:// document; opt out of referrer
      // leakage for tracking-pixel style references.
      image.referrerPolicy = "no-referrer";
      image.addEventListener(
        "load",
        () =>
          imageDebug("image-load", {
            source: this.source,
            documentFrom: this.documentFrom,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          }),
        { once: true },
      );
      image.addEventListener(
        "error",
        () =>
          imageDebug("image-error", {
            source: this.source,
            documentFrom: this.documentFrom,
          }),
        { once: true },
      );
      wrapper.appendChild(image);
    } else {
      wrapper.classList.add("zmd-lp-image-missing");
      wrapper.textContent = this.error || "图片缺失或尚未同步";
    }
    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "dblclick";
  }
}

class TableCellWidget extends WidgetType {
  constructor(
    readonly value: string,
    readonly alignment: TableAlignment,
    readonly header: boolean,
    readonly tableFrom: number,
    readonly rowIndex: number,
    readonly columnIndex: number,
    readonly lastColumn: boolean,
    readonly from: number,
    readonly to: number,
    readonly editing: boolean,
    readonly caretOffset: number,
    readonly selected: boolean,
    readonly readOnly: boolean,
  ) {
    super();
  }

  /**
   * CodeMirror consults this after `toDOM()`. It must be true for editing
   * cells, otherwise `WidgetTile.of` resets `contenteditable` to "false"
   * and the cell can neither be focused nor receive keyboard input.
   */
  get editable() {
    return this.editing && !this.readOnly;
  }

  eq(other: TableCellWidget) {
    return (
      this.value === other.value &&
      this.alignment === other.alignment &&
      this.header === other.header &&
      this.tableFrom === other.tableFrom &&
      this.rowIndex === other.rowIndex &&
      this.columnIndex === other.columnIndex &&
      this.lastColumn === other.lastColumn &&
      this.from === other.from &&
      this.to === other.to &&
      this.editing === other.editing &&
      this.caretOffset === other.caretOffset &&
      this.selected === other.selected &&
      this.readOnly === other.readOnly
    );
  }

  updateDOM(dom: HTMLElement, _view: EditorView, oldWidget: TableCellWidget) {
    // The DOM carries listeners whose closures capture the original widget's
    // cell identity. Reusing DOM across different logical cells would make
    // clicks dispatch activation for the previous cell ("content lands in the
    // wrong cell"), so only reuse DOM for the same logical cell.
    if (!sameTableCellIdentity(this, oldWidget)) {
      return false;
    }
    // Editing <-> rendered transitions must recreate the DOM so editing
    // listeners (input/composition/keydown) are attached by toDOM().
    if (this.editing !== oldWidget.editing) return false;
    if (this.readOnly !== oldWidget.readOnly) return false;

    this.applyDomIdentity(dom);
    if (this.editing && !this.readOnly) {
      dom.contentEditable = "true";
      dom.setAttribute("role", "textbox");
      dom.setAttribute("aria-multiline", "false");
      dom.classList.add(
        "zmd-lp-table-cell-active",
        "zmd-lp-table-cell-editing",
      );
      // While the user is typing, the DOM already holds the new value and
      // the selection must not be disturbed. External updates (undo, title
      // sync, setValue) are synced when the cell is not focused.
      const focused =
        dom.ownerDocument.activeElement === dom ||
        dom.contains(dom.ownerDocument.activeElement);
      if (!focused && (dom.textContent || "") !== this.value) {
        dom.textContent = this.value;
      }
    } else {
      dom.contentEditable = "false";
      dom.classList.remove(
        "zmd-lp-table-cell-active",
        "zmd-lp-table-cell-editing",
      );
      dom.removeAttribute("role");
      dom.removeAttribute("aria-multiline");
      dom.replaceChildren();
      appendRenderedInline(dom, this.value);
    }
    return true;
  }

  applyDomIdentity(cell: HTMLElement) {
    cell.className = `zmd-lp-table-cell zmd-lp-table-align-${this.alignment || "default"}`;
    if (this.header) cell.classList.add("zmd-lp-table-header-cell");
    if (this.lastColumn) cell.classList.add("zmd-lp-table-last-cell");
    if (this.selected) cell.classList.add("zmd-lp-table-cell-selected");
    cell.style.gridColumn = String(this.columnIndex + 1);
    cell.dataset.zmdTableFrom = String(this.tableFrom);
    cell.dataset.zmdTableCellFrom = String(this.from);
    cell.dataset.zmdTableCellTo = String(this.to);
    cell.dataset.zmdTableCellRow = String(this.rowIndex);
    cell.dataset.zmdTableCellColumn = String(this.columnIndex);
  }

  toDOM() {
    const cell = document.createElement("span");
    this.applyDomIdentity(cell);
    if (this.editing) cell.classList.add("zmd-lp-table-cell-active");
    const emitActivate = (event: MouseEvent) => {
      if (this.readOnly) return;
      if (this.editing && event.type === "mousedown") {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const CustomEventConstructor =
        cell.ownerDocument.defaultView?.CustomEvent || CustomEvent;
      cell.dispatchEvent(
        new CustomEventConstructor<TableCellActivateDetail>(
          TABLE_CELL_ACTIVATE_EVENT,
          {
            bubbles: true,
            detail: {
              tableFrom: this.tableFrom,
              rowIndex: this.rowIndex,
              columnIndex: this.columnIndex,
              caretOffset: this.value.length,
            },
          },
        ),
      );
    };
    cell.addEventListener("mousedown", emitActivate);
    if (this.editing && !this.readOnly) {
      cell.classList.add("zmd-lp-table-cell-editing");
      cell.contentEditable = "true";
      cell.setAttribute("role", "textbox");
      cell.setAttribute("aria-multiline", "false");
      cell.spellcheck = false;
      cell.textContent = this.value;
      let composing = false;
      let compositionTimer: number | undefined;
      let awaitingCompositionInput = false;
      const caretOffset = () => {
        const selection = cell.ownerDocument.getSelection();
        if (!selection?.rangeCount || !cell.contains(selection.anchorNode)) {
          return cell.textContent?.length || 0;
        }
        const range = cell.ownerDocument.createRange();
        range.selectNodeContents(cell);
        range.setEnd(selection.anchorNode!, selection.anchorOffset);
        return range.toString().length;
      };
      const emitInput = () => {
        const CustomEventConstructor =
          cell.ownerDocument.defaultView?.CustomEvent || CustomEvent;
        cell.dispatchEvent(
          new CustomEventConstructor(TABLE_CELL_INPUT_EVENT, {
            bubbles: true,
            detail: {
              value: cell.textContent || "",
              caretOffset: caretOffset(),
            },
          }),
        );
      };
      // `WidgetType.ignoreEvent` already returns true for every cell event
      // except contextmenu, so CodeMirror ignores these natively. A capture
      // listener that calls stopPropagation here would also stop the bubble
      // listeners attached to this very cell (browser behavior), which kept
      // input/IME events from ever reaching `emitInput`.
      cell.addEventListener("beforeinput", (event) => {
        const input = event as InputEvent;
        if (
          input.inputType === "insertParagraph" ||
          input.inputType === "insertLineBreak"
        ) {
          event.preventDefault();
          const CustomEventConstructor =
            cell.ownerDocument.defaultView?.CustomEvent || CustomEvent;
          cell.dispatchEvent(
            new CustomEventConstructor(TABLE_CELL_COMMIT_EVENT, {
              bubbles: true,
            }),
          );
        }
      });
      cell.addEventListener("compositionstart", () => {
        composing = true;
      });
      cell.addEventListener("compositionend", () => {
        composing = false;
        awaitingCompositionInput = true;
        compositionTimer = cell.ownerDocument.defaultView?.setTimeout(() => {
          awaitingCompositionInput = false;
          if (cell.isConnected) emitInput();
        }, 0);
      });
      cell.addEventListener("input", () => {
        if (composing) return;
        if (awaitingCompositionInput) {
          awaitingCompositionInput = false;
          if (compositionTimer !== undefined) {
            cell.ownerDocument.defaultView?.clearTimeout(compositionTimer);
          }
          cell.ownerDocument.defaultView?.setTimeout(() => {
            if (cell.isConnected) emitInput();
          }, 0);
          return;
        }
        emitInput();
      });
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          const CustomEventConstructor =
            cell.ownerDocument.defaultView?.CustomEvent || CustomEvent;
          cell.dispatchEvent(
            new CustomEventConstructor(TABLE_CELL_NAVIGATE_EVENT, {
              bubbles: true,
              detail: { backwards: event.shiftKey },
            }),
          );
        } else if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          const CustomEventConstructor =
            cell.ownerDocument.defaultView?.CustomEvent || CustomEvent;
          cell.dispatchEvent(
            new CustomEventConstructor(TABLE_CELL_COMMIT_EVENT, {
              bubbles: true,
            }),
          );
        }
      });
      const focus = () => {
        if (!cell.isConnected) return;
        cell.focus();
        const selection = cell.ownerDocument.getSelection();
        const range = cell.ownerDocument.createRange();
        const node = cell.firstChild || cell;
        const offset = Math.min(
          this.caretOffset,
          node.nodeType === 3 ? node.textContent?.length || 0 : 0,
        );
        range.setStart(node, offset);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      cell.ownerDocument.defaultView?.requestAnimationFrame(focus);
    } else {
      appendRenderedInline(cell, this.value);
    }
    return cell;
  }

  ignoreEvent(event: Event) {
    return event.type !== "contextmenu";
  }
}

class TableEdgeActionsWidget extends WidgetType {
  private railResizeObserver: ResizeObserver | null = null;

  constructor(
    readonly tableFrom: number,
    readonly columnPosition: number,
    readonly rowPosition: number,
    readonly visibleRowCount: number,
    readonly rowIndex: number,
    readonly columnCount: number,
    readonly firstRow: boolean,
    readonly finalRow: boolean,
    readonly selectedRow: boolean,
    readonly selectedColumn: number | null,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: TableEdgeActionsWidget) {
    return (
      this.tableFrom === other.tableFrom &&
      this.columnPosition === other.columnPosition &&
      this.rowPosition === other.rowPosition &&
      this.visibleRowCount === other.visibleRowCount &&
      this.rowIndex === other.rowIndex &&
      this.columnCount === other.columnCount &&
      this.firstRow === other.firstRow &&
      this.finalRow === other.finalRow &&
      this.selectedRow === other.selectedRow &&
      this.selectedColumn === other.selectedColumn &&
      this.readOnly === other.readOnly
    );
  }

  destroy(_dom: HTMLElement) {
    this.railResizeObserver?.disconnect();
    this.railResizeObserver = null;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "zmd-lp-table-edge-actions";
    wrapper.contentEditable = "false";
    if (this.readOnly) return wrapper;

    const addButton = (
      action: TableEdgeAction,
      position: number,
      className: string,
      label: string,
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `zmd-lp-table-edge-action ${className}`;
      button.title = label;
      button.setAttribute("aria-label", label);
      if (className.includes("is-column")) {
        const glyph = document.createElement("span");
        glyph.className = "zmd-lp-table-edge-glyph";
        glyph.textContent = "+";
        glyph.setAttribute("aria-hidden", "true");
        button.appendChild(glyph);
      } else {
        button.textContent = "+";
      }
      const stop = (event: Event) => event.stopPropagation();
      button.addEventListener("pointerdown", stop);
      button.addEventListener("mousedown", stop);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const CustomEventConstructor =
          wrapper.ownerDocument.defaultView?.CustomEvent || CustomEvent;
        wrapper.dispatchEvent(
          new CustomEventConstructor<TableEdgeActionDetail>(
            TABLE_EDGE_ACTION_EVENT,
            {
              bubbles: true,
              detail: { position, action },
            },
          ),
        );
      });
      wrapper.appendChild(button);
      return button;
    };

    const addDragHandle = (
      kind: "row" | "column",
      label: string,
      columnIndex?: number,
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `zmd-lp-table-${kind}-handle`;
      button.dataset.zmdTableDrag = kind;
      button.dataset.zmdTableFrom = String(this.tableFrom);
      if (kind === "row") {
        button.dataset.zmdTableRow = String(this.rowIndex);
      } else {
        button.dataset.zmdTableColumn = String(columnIndex ?? 0);
        button.style.gridColumn = String((columnIndex ?? 0) + 1);
      }
      button.title = label;
      button.setAttribute("aria-label", label);
      const selected =
        (kind === "row" && this.selectedRow) ||
        (kind === "column" && this.selectedColumn === columnIndex);
      if (selected) {
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
      }
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      wrapper.appendChild(button);
      return button;
    };

    // Row reorder handle on body rows only; the header stays fixed.
    if (this.rowIndex > 0) {
      addDragHandle("row", "拖动调整行顺序");
    }
    if (this.firstRow) {
      for (let columnIndex = 0; columnIndex < this.columnCount; columnIndex++) {
        addDragHandle("column", "拖动调整列顺序", columnIndex);
      }
    }

    // One continuous rail for the whole table, rendered only on the first
    // row. Its pixel height is measured from the real row boxes (sum of row
    // heights minus the bottom gutter reserved for the append-row button),
    // so it never extends past the table even when rows have different
    // heights.
    if (this.firstRow) {
      const columnButton = addButton(
        "append-column",
        this.columnPosition,
        "is-column is-first-row",
        "在右侧新增列",
      );
      const syncRailHeight = () => {
        const rows = Array.from(
          wrapper.ownerDocument.querySelectorAll<HTMLElement>(
            `.cm-line.zmd-lp-table-row[data-zmd-table-from="${this.tableFrom}"]`,
          ),
        );
        let contentHeight = 0;
        for (const row of rows) {
          contentHeight += row.getBoundingClientRect().height;
        }
        const gutterRaw = getComputedStyle(wrapper).getPropertyValue(
          "--zmd-table-edge-size",
        );
        const gutter = parseFloat(gutterRaw || "30");
        columnButton.style.height = `${Math.max(
          0,
          contentHeight - (Number.isFinite(gutter) ? gutter : 30),
        )}px`;
      };
      wrapper.ownerDocument.defaultView?.requestAnimationFrame(() =>
        syncRailHeight(),
      );
      const content = wrapper.ownerDocument.querySelector(".cm-content");
      const ResizeObserverCtor =
        wrapper.ownerDocument.defaultView?.ResizeObserver;
      if (content && ResizeObserverCtor) {
        this.railResizeObserver = new ResizeObserverCtor(() =>
          syncRailHeight(),
        );
        this.railResizeObserver.observe(content);
      }
    }
    if (this.finalRow) {
      addButton("append-row", this.rowPosition, "is-row", "在下方新增行");
    }
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

function appendRenderedInline(parent: HTMLElement, value: string) {
  const ranges = parseInlineL2(value).sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const range of ranges) {
    if (range.from > cursor) {
      parent.append(value.slice(cursor, range.from));
    }
    if (range.kind !== "mark") {
      const span = document.createElement("span");
      span.className = `zmd-lp-${range.kind}`;
      span.textContent = value.slice(range.from, range.to);
      parent.appendChild(span);
    }
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < value.length) parent.append(value.slice(cursor));
  if (!parent.hasChildNodes()) parent.textContent = "\u00a0";
}

function intersects(
  from: number,
  to: number,
  ranges: Array<{ from: number; to: number }>,
) {
  return ranges.some((range) => from < range.to && to > range.from);
}

/** Structural line decorations must come from a StateField, not a ViewPlugin. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  try {
    console.log("[Bamboo][EditorDebug] block-decorations-start", {
      lines: state.doc.lines,
      length: state.doc.length,
    });
  } catch {
    // ignore console failures in chrome documents
  }
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }
  const lineTexts = lines.map((line) => line.text);
  const fm = frontmatterLineNumbersFromLines(lineTexts);
  const fencedCode = fencedCodeLineKindsFromLines(lineTexts);
  const tableRows = new Map(
    liveTableRows(state).map((row) => [row.line, row] as const),
  );
  const tableDelimiterLines = new Set(
    [...tableRows.values()]
      .filter((row) => row.kind === "header")
      .map((row) => row.line + 1),
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (fm.has(lineNumber)) continue;
    const tableRow = tableRows.get(lineNumber);
    if (tableRow) {
      const rowClasses = ["zmd-lp-table-row", `zmd-lp-table-${tableRow.kind}`];
      if (tableRow.isLast) rowClasses.push("zmd-lp-table-last-row");
      ranges.push(
        Decoration.line({
          attributes: {
            class: rowClasses.join(" "),
            style: `--zmd-table-columns: ${tableRow.columnCount}; --zmd-table-visible-rows: ${tableRow.visibleRowCount}; --zmd-table-row-index: ${tableRow.cells[0]?.rowIndex ?? 0}`,
            "data-zmd-table-from": String(tableRow.tableFrom),
            "data-zmd-table-row-index": String(
              tableRow.cells[0]?.rowIndex ?? 0,
            ),
          },
        }).range(line.from),
      );
      continue;
    }
    if (tableDelimiterLines.has(lineNumber)) {
      ranges.push(
        Decoration.line({ class: "zmd-lp-table-delimiter" }).range(line.from),
      );
      continue;
    }
    const codeLineKind = fencedCode[index];
    if (codeLineKind) {
      ranges.push(
        Decoration.line({
          class:
            codeLineKind === "content"
              ? "zmd-lp-code-block"
              : "zmd-lp-code-fence",
        }).range(line.from),
      );
      continue;
    }
    const parsed = cachedLineParse(line.text, false);
    if (parsed.heading) {
      ranges.push(
        Decoration.line({ class: `zmd-lp-h${parsed.heading.level}` }).range(
          line.from,
        ),
      );
    } else if (parsed.list) {
      ranges.push(Decoration.line({ class: "zmd-lp-list" }).range(line.from));
    } else if (parsed.quote) {
      ranges.push(Decoration.line({ class: "zmd-lp-quote" }).range(line.from));
    }
  }
  const decorations = Decoration.set(ranges, true);
  try {
    console.log("[Bamboo][EditorDebug] block-decorations-complete", {
      count: ranges.length,
    });
  } catch {
    // ignore console failures in chrome documents
  }
  return decorations;
}

const livePreviewBlockDecorations = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update: (decorations, transaction) =>
    transaction.docChanged
      ? buildBlockDecorations(transaction.state)
      : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Build live-preview decorations.
 *
 * - Inactive lines: replace-hide MD markers (not CSS collapse — keeps click mapping accurate).
 * - Active lines: show markers with muted style, keep structural/inline styles.
 * - Frontmatter: no live styling.
 */
function buildDecorations(
  state: EditorState,
  composing: boolean,
  imageAssets: ImageAssetMap,
  activeCell: TableCellEditTarget | null,
  tableSelection: TableSelection,
): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const doc = asDocLines(state);
  const sel = state.selection.main;
  const active = activeLinesFromSelection(doc, sel.from, sel.to);
  if (composing) {
    active.add(doc.lineAt(sel.head).number);
  }
  // Single pass over all lines; the parsed text array feeds the frontmatter /
  // fenced-code passes and the main decoration loop, so a full rebuild is
  // one scan instead of three.
  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }
  const lineTexts = lines.map((line) => line.text);
  const fm = frontmatterLineNumbersFromLines(lineTexts);
  const fencedCode = fencedCodeLineKindsFromLines(lineTexts);
  const tableRows = new Map(
    liveTableRows(state).map((row) => [row.line, row] as const),
  );
  const tableDelimiterLines = new Set(
    [...tableRows.values()]
      .filter((row) => row.kind === "header")
      .map((row) => row.line + 1),
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const n = index + 1;
    if (fm.has(n)) continue;

    const text = line.text;
    const base = line.from;
    const isActive = active.has(n);
    const hideMarks = !isActive;
    const parsed = cachedLineParse(text, isActive);
    const images = parsed.images;
    const imagePlans = parsed.imagePlans;
    const codeLineKind = fencedCode[n - 1];

    const tableRow = tableRows.get(n);
    if (tableRow) {
      let cursor = line.from;
      tableRow.cells.forEach((cell, index) => {
        const widget = new TableCellWidget(
          state.doc.sliceString(cell.from, cell.to),
          tableRow.alignments[index] || null,
          tableRow.kind === "header",
          tableRow.tableFrom,
          cell.rowIndex ?? 0,
          cell.columnIndex ?? 0,
          index === tableRow.cells.length - 1,
          cell.from,
          cell.to,
          !!activeCell &&
            activeCell.tableFrom === tableRow.tableFrom &&
            activeCell.rowIndex === (cell.rowIndex ?? 0) &&
            activeCell.columnIndex === (cell.columnIndex ?? 0),
          activeCell?.caretOffset || 0,
          tableSelection?.tableFrom === tableRow.tableFrom &&
            selectionContainsCell(
              tableSelection,
              cell.rowIndex ?? 0,
              cell.columnIndex ?? 0,
            ),
          state.readOnly,
        );
        const widgetRange = cellWidgetRange(cell);
        if (cursor < widgetRange.from) {
          ranges.push(hideRange(cursor, widgetRange.from));
        }
        if (widgetRange.point) {
          ranges.push(
            Decoration.widget({ widget, side: -1 }).range(widgetRange.from),
          );
        } else {
          ranges.push(
            Decoration.replace({ widget }).range(
              widgetRange.from,
              widgetRange.to,
            ),
          );
        }
        cursor = widgetRange.to;
      });
      if (cursor < line.to) ranges.push(hideRange(cursor, line.to));
      ranges.push(
        Decoration.widget({
          widget: new TableEdgeActionsWidget(
            tableRow.tableFrom,
            tableRow.cells.at(-1)?.from ?? line.from,
            tableRow.cells[0]?.from ?? line.from,
            tableRow.visibleRowCount,
            tableRow.cells[0]?.rowIndex ?? 0,
            tableRow.columnCount,
            (tableRow.cells[0]?.rowIndex ?? 0) === 0,
            tableRow.isLast,
            tableSelection?.tableFrom === tableRow.tableFrom &&
              tableSelection?.kind === "row" &&
              tableSelection.rowIndex === (tableRow.cells[0]?.rowIndex ?? 0),
            tableSelection?.tableFrom === tableRow.tableFrom &&
              tableSelection?.kind === "column"
              ? tableSelection.columnIndex
              : null,
            state.readOnly,
          ),
          side: 1,
        }).range(line.to),
      );
      continue;
    }

    if (tableDelimiterLines.has(n)) {
      if (text.length) ranges.push(hideRange(base, line.to));
      continue;
    }

    if (codeLineKind) {
      if (codeLineKind !== "content") {
        if (text.length) {
          ranges.push(
            isActive ? syntaxRange(base, line.to) : hideRange(base, line.to),
          );
        }
      }
      continue;
    }

    for (const image of imagePlans) {
      const normalized = normalizeAssetReference(image.source);
      const resolved = normalized ? imageAssets[normalized] : undefined;
      const widget = new ImageWidget(
        image.alt,
        image.source,
        base + image.from,
        resolved?.dataUrl,
        resolved?.error,
      );
      if (image.kind === "replace") {
        ranges.push(
          Decoration.replace({ widget }).range(
            base + image.from,
            base + image.to,
          ),
        );
      } else {
        ranges.push(
          // ViewPlugin decorations cannot be structural block widgets.
          // The widget DOM is display:block, so an inline widget at line end
          // still renders the preview beneath the visible Markdown source.
          Decoration.widget({ widget, side: 1 }).range(base + image.from),
        );
      }
    }

    const heading = parsed.heading;
    if (heading) {
      if (heading.markEnd > 0) {
        ranges.push(
          hideMarks
            ? hideRange(base, base + heading.markEnd)
            : syntaxRange(base, base + heading.markEnd),
        );
      }
    } else {
      const list = parsed.list;
      if (list) {
        ranges.push(
          hideMarks
            ? listMarkerRange(base, base + list.markEnd, list)
            : syntaxRange(base, base + list.markEnd),
        );
      } else {
        const quote = parsed.quote;
        if (quote) {
          ranges.push(
            hideMarks
              ? hideRange(base, base + quote.markEnd)
              : syntaxRange(base, base + quote.markEnd),
          );
        }
      }
    }

    const inlines = parsed.inlines;
    for (const r of inlines) {
      if (r.from >= r.to) continue;
      if (hideMarks && intersects(r.from, r.to, images)) continue;
      const from = base + r.from;
      const to = base + r.to;
      if (r.kind === "mark") {
        ranges.push(hideMarks ? hideRange(from, to) : syntaxRange(from, to));
      } else if (r.kind === "strong") {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-strong" }).range(from, to),
        );
      } else if (r.kind === "em") {
        ranges.push(Decoration.mark({ class: "zmd-lp-em" }).range(from, to));
      } else if (r.kind === "strike") {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-strike" }).range(from, to),
        );
      } else if (r.kind === "code") {
        ranges.push(Decoration.mark({ class: "zmd-lp-code" }).range(from, to));
      } else if (r.kind === "link") {
        ranges.push(Decoration.mark({ class: "zmd-lp-link" }).range(from, to));
      }
    }
  }

  return Decoration.set(ranges, true);
}

class LivePreviewPlugin {
  decorations: DecorationSet;
  composing = false;
  imageAssets: ImageAssetMap = {};
  activeCell: TableCellEditTarget | null = null;
  tableSelection: TableSelection = null;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(
      view.state,
      this.composing,
      this.imageAssets,
      this.activeCell,
      this.tableSelection,
    );
  }

  update(update: ViewUpdate) {
    // IME `compositionend` can be lost on blur / window teardown; without a
    // reset the line would stay styled as the active line forever. Reset
    // when the editor no longer has focus; the next rebuild applies it.
    if (this.composing && !update.view.hasFocus) {
      this.composing = false;
    }
    let effectChanged = false;
    let activeEffectSet = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setLiveImageAssets)) {
          this.imageAssets = effect.value;
          effectChanged = true;
        } else if (effect.is(setLiveTableCellEdit)) {
          this.activeCell = effect.value;
          effectChanged = true;
          activeEffectSet = true;
        } else if (effect.is(setLiveTableSelection)) {
          this.tableSelection = effect.value;
          effectChanged = true;
        }
      }
    }
    if (update.docChanged && this.activeCell && !activeEffectSet) {
      this.activeCell = remapActiveCell(
        update.state,
        this.activeCell,
        update.changes.mapPos(this.activeCell.tableFrom, 1),
      );
    }
    if (
      effectChanged ||
      update.docChanged ||
      update.selectionSet
      // Deliberately NOT `viewportChanged` / `geometryChanged`: the
      // decoration set is document-wide and CodeMirror renders it per
      // viewport itself, so scrolling or resizing must not trigger a full
      // O(doc) rebuild on every frame.
    ) {
      this.decorations = buildDecorations(
        update.state,
        this.composing,
        this.imageAssets,
        this.activeCell,
        this.tableSelection,
      );
    }
  }

  setComposing(view: EditorView, value: boolean) {
    if (this.composing === value) return;
    this.composing = value;
    this.decorations = buildDecorations(
      view.state,
      this.composing,
      this.imageAssets,
      this.activeCell,
      this.tableSelection,
    );
    view.dispatch({});
  }
}

const livePreviewViewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    compositionstart(this: LivePreviewPlugin, _event, view) {
      this.setComposing(view, true);
    },
    compositionend(this: LivePreviewPlugin, _event, view) {
      this.setComposing(view, false);
    },
  },
});

/** Live preview decorations (headings, emphasis, list, quote, link, code). */
export function livePreviewPlugin(): Extension {
  return [livePreviewBlockDecorations, livePreviewViewPlugin];
}
