import { syntaxTree } from "@codemirror/language";
import {
  liveBlockMarkers,
  TaskCheckboxWidget,
  HorizontalRuleWidget,
} from "./blocks";
/// <reference lib="dom" />

import {
  EditorState,
  StateEffect,
  StateField,
  ChangeSet,
  type ChangeDesc,
  type Transaction,
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
import { parseMathRanges, type MathRange } from "./math-syntax";
import { MathWidget } from "./math";
import { renderMath } from "../../modules/markdown/math";
import type { DocLines, LineInfo } from "./types";
import {
  assetReferenceCandidates,
  imageAssetFromMap,
  parseReferenceImageDocument,
  type MarkdownImageReference,
} from "../../modules/markdown/images/model";
import { planLiveImageDecorations } from "./images";
import { editorTableLabels } from "../table-config";
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
    readonly documentTo: number,
    readonly width?: number,
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
      this.documentTo === other.documentTo &&
      this.width === other.width &&
      this.dataUrl === other.dataUrl &&
      this.error === other.error
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "zmd-lp-image";
    wrapper.dataset.zmdImageFrom = String(this.documentFrom);
    wrapper.dataset.zmdImageTo = String(this.documentTo);
    const displaySource =
      this.dataUrl || (/^https?:\/\//i.test(this.source) ? this.source : "");
    // Re-request on every render while the asset is unresolved: `assets.ts`
    // dedupes in-flight requests and cooldowns retries after failures.
    if (!this.dataUrl) {
      const candidates = assetReferenceCandidates(this.source);
      for (const reference of candidates.length ? candidates : [this.source])
        requestLiveAsset(reference);
    }
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
      image.tabIndex = 0;
      image.draggable = false;
      if (this.width) image.width = this.width;
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

  toDOM(view: EditorView) {
    const labels = view.state.facet(editorTableLabels);
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
      addDragHandle("row", labels["drag-row"]);
    }
    if (this.firstRow) {
      for (let columnIndex = 0; columnIndex < this.columnCount; columnIndex++) {
        addDragHandle("column", labels["drag-column"], columnIndex);
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
        labels["append-column"],
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
      addButton("append-row", this.rowPosition, "is-row", labels["append-row"]);
    }
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

function appendRenderedInline(parent: HTMLElement, value: string) {
  const formulas = parseMathRanges(value);
  const ranges = [
    ...parseInlineL2(value).filter(
      (range) => !intersects(range.from, range.to, formulas),
    ),
    ...formulas.map((formula) => ({ ...formula, kind: "math" as const })),
  ].sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const range of ranges) {
    if (range.from > cursor) {
      parent.append(value.slice(cursor, range.from));
    }
    if (range.kind !== "mark") {
      const span = document.createElement("span");
      span.className = `zmd-lp-${range.kind}`;
      if (range.kind === "math")
        span.innerHTML = renderMath(range.content, range.display);
      else span.textContent = value.slice(range.from, range.to);
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
export function buildBlockDecorations(
  state: EditorState,
  lineNumbers?: ReadonlySet<number>,
): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const structure = state.field(liveStructure);
  const { fm, fencedCode, tableDelimiterLines } = structure;
  const lines = linesToBuild(state, lineNumbers);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = line.number;
    if (fm.has(lineNumber)) continue;
    if (
      mathOnLine(state, structure, lineNumber).some(
        (formula) =>
          formula.display || formula.from < line.from || formula.to > line.to,
      )
    )
      continue;
    const tableRow = tableRowAt(state, structure, lineNumber);
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
    const codeLineKind = fencedCode[lineNumber - 1];
    if (codeLineKind) {
      ranges.push(
        Decoration.line({
          class:
            codeLineKind === "content"
              ? "zmd-lp-code-block"
              : `zmd-lp-code-fence zmd-lp-code-${codeLineKind}`,
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
  return Decoration.set(ranges, true);
}

export const livePreviewBlockDecorations = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update: (decorations, transaction) => {
    if (transaction.docChanged) {
      if (!canUpdateLocally(transaction))
        return buildBlockDecorations(transaction.state);
      const lines = changedLines(transaction);
      return replaceLineDecorations(
        decorations.map(transaction.changes),
        transaction.state,
        lines,
        buildBlockDecorations(transaction.state, lines),
      );
    }
    return transaction.state.field(liveStructure) !==
      transaction.startState.field(liveStructure)
      ? buildBlockDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function referenceImagesByLine(state: EditorState) {
  const images = new Map<number, MarkdownImageReference[]>();
  const references = parseReferenceImageDocument(state.doc.toString());
  const definitionLines = new Set<number>();
  for (const range of references.definitions)
    for (
      let number = state.doc.lineAt(range.from).number;
      number <= state.doc.lineAt(range.to).number;
      number++
    )
      definitionLines.add(number);
  for (const image of references.images) {
    const line = state.doc.lineAt(image.from);
    // A ViewPlugin cannot replace line breaks. Keep multiline alt text as
    // source; reading mode still uses the full CommonMark image renderer.
    if (image.to > line.to) continue;
    const entries = images.get(line.number) ?? [];
    entries.push({
      ...image,
      from: image.from - line.from,
      to: image.to - line.from,
    });
    images.set(line.number, entries);
  }
  return { images, definitionLines };
}

function buildStructure(state: EditorState) {
  const lines = state.doc.toJSON();
  const fm = frontmatterLineNumbersFromLines(lines);
  const fencedCode = fencedCodeLineKindsFromLines(lines);
  const excludedMath: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter({ node }) {
      if (
        !/^(?:FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock|ProcessingInstructionBlock|URL|Image|LinkReference)$/.test(
          node.name,
        )
      )
        return;
      excludedMath.push({ from: node.from, to: node.to });
      return false;
    },
  });
  for (let number = 1; number <= lines.length; number++) {
    if (fm.has(number) || fencedCode[number - 1]) {
      const line = state.doc.line(number);
      excludedMath.push({ from: line.from, to: line.to });
    }
  }
  const formulas = parseMathRanges(state.doc.toString(), excludedMath);
  const mathLines = new Map<number, MathRange[]>();
  for (const formula of formulas)
    for (
      let number = state.doc.lineAt(formula.from).number;
      number <= state.doc.lineAt(formula.to).number;
      number++
    ) {
      const entries = mathLines.get(number) ?? [];
      entries.push(formula);
      mathLines.set(number, entries);
    }
  const tableRows = new Map(
    liveTableRows(state)
      .filter(
        (row) =>
          !mathLines
            .get(row.line)
            ?.some(
              (formula) =>
                formula.display ||
                state.doc.lineAt(formula.from).number !==
                  state.doc.lineAt(formula.to).number,
            ),
      )
      .map((row) => [row.line, row] as const),
  );
  const markers = liveBlockMarkers(state);
  const imageLines = new Map<string, Set<number>>();
  const { images: references, definitionLines: structuralLines } =
    referenceImagesByLine(state);
  syntaxTree(state).iterate({
    enter({ node }) {
      if (
        !/^(?:HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/.test(
          node.name,
        )
      )
        return;
      for (
        let number = state.doc.lineAt(node.from).number;
        number <= state.doc.lineAt(node.to).number;
        number++
      )
        structuralLines.add(number);
    },
  });
  const allImageLines = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes("![") && !/<img\b/i.test(lines[index])) continue;
    for (const image of [
      ...cachedLineParse(lines[index], false).images,
      ...(references.get(index + 1) ?? []),
    ]) {
      allImageLines.add(index + 1);
      for (const reference of assetReferenceCandidates(image.source)) {
        const entries = imageLines.get(reference) ?? new Set<number>();
        entries.add(index + 1);
        imageLines.set(reference, entries);
      }
    }
  }
  const tableLines = new Map<number, Set<number>>();
  for (const row of tableRows.values()) {
    const entries = tableLines.get(row.tableFrom) ?? new Set<number>();
    entries.add(row.line);
    tableLines.set(row.tableFrom, entries);
  }
  const widgetLines = new Set([
    ...markers.tasks.keys(),
    ...markers.rules.keys(),
    ...tableRows.keys(),
    ...allImageLines,
    ...mathLines.keys(),
  ]);
  for (const entries of imageLines.values())
    for (const number of entries) widgetLines.add(number);
  return {
    fm,
    fencedCode,
    formulas,
    mathLines,
    tableRows,
    tableLines,
    tableDelimiterLines: new Set(
      [...tableRows.values()]
        .filter((row) => row.kind === "header")
        .map((row) => row.line + 1),
    ),
    markers,
    references,
    imageLines,
    widgetLines,
    structuralLines,
    mapping: ChangeSet.empty(state.doc.length).desc as ChangeDesc,
    mappedEdits: 0,
    tree: syntaxTree(state),
    syntaxPending: syntaxTree(state).length < state.doc.length,
  };
}

type LiveStructure = ReturnType<typeof buildStructure>;

function mappedMath(
  state: EditorState,
  structure: LiveStructure,
  formula: MathRange,
): MathRange {
  const from = structure.mapping.mapPos(formula.from, 1);
  const to = structure.mapping.mapPos(formula.to, -1);
  return {
    ...formula,
    from,
    to,
    content: state.doc.sliceString(
      from + formula.delimiterLength,
      to - formula.delimiterLength,
    ),
  };
}

function mathOnLine(
  state: EditorState,
  structure: LiveStructure,
  number: number,
): MathRange[] {
  return (structure.mathLines.get(number) ?? []).map((formula) =>
    mappedMath(state, structure, formula),
  );
}

/** Direct decorations can replace line breaks, unlike ViewPlugin decorations. */
export function buildMathDecorations(state: EditorState): DecorationSet {
  const structure = state.field(liveStructure);
  const decorations: ReturnType<Decoration["range"]>[] = [];
  for (const original of structure.formulas) {
    const formula = mappedMath(state, structure, original);
    const first = state.doc.lineAt(formula.from).number;
    const last = state.doc.lineAt(formula.to).number;
    // The table widget owns its cell DOM, including rendered inline math.
    if (structure.tableRows.has(first)) continue;
    const editing = state.selection.ranges.some(
      (selection) =>
        state.doc.lineAt(selection.from).number <= last &&
        state.doc.lineAt(selection.to).number >= first,
    );
    decorations.push(
      editing
        ? syntaxRange(formula.from, formula.to)
        : Decoration.replace({
            widget: new MathWidget(formula),
            block: formula.display,
            inclusive: false,
          }).range(formula.from, formula.to),
    );
  }
  return Decoration.set(decorations, true);
}

export const livePreviewMathDecorations = StateField.define<DecorationSet>({
  create: buildMathDecorations,
  update(decorations, transaction) {
    return transaction.docChanged ||
      transaction.selection ||
      transaction.state.field(liveStructure) !==
        transaction.startState.field(liveStructure)
      ? buildMathDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function canUpdateLocally(transaction: Transaction): boolean {
  const structure = transaction.startState.field(liveStructure);
  if (structure.syntaxPending) {
    const tree = syntaxTree(transaction.state);
    const mappedCoverage = transaction.changes.mapPos(structure.tree.length, 1);
    // A partial cache describes only the previously parsed coverage. Keep
    // safe local edits cheap while that coverage is stable, but refresh when
    // parsing advances (or retreats) so newly known markers are not lost.
    if (
      tree.length === transaction.state.doc.length ||
      tree.length !== mappedCoverage
    )
      return false;
  }
  if (structure.mappedEdits >= 128) return false;
  let local = true;
  transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
    const before = transaction.startState.doc.lineAt(fromA);
    const after = transaction.state.doc.lineAt(fromB);
    if (
      before.number !== transaction.startState.doc.lineAt(toA).number ||
      after.number !== transaction.state.doc.lineAt(toB).number ||
      !before.text.trim() ||
      !after.text.trim() ||
      structure.fm.has(before.number) ||
      structure.fencedCode[before.number - 1] ||
      structure.tableRows.has(before.number) ||
      structure.structuralLines.has(before.number)
    ) {
      local = false;
      return;
    }
    let beforeText = before.text;
    let afterText = after.text;
    const beforeMath = mathOnLine(
      transaction.startState,
      structure,
      before.number,
    );
    if (beforeMath.length) {
      const afterMath = parseMathRanges(after.text).map((formula) => ({
        ...formula,
        from: after.from + formula.from,
        to: after.from + formula.to,
      }));
      const changedText =
        transaction.startState.doc.sliceString(fromA, toA) +
        transaction.state.doc.sliceString(fromB, toB);
      const stable =
        beforeMath.length === afterMath.length &&
        !/[\\$[\]()`*_~<>]/.test(changedText) &&
        beforeMath.every(
          (formula, index) =>
            !formula.display &&
            formula.from >= before.from &&
            formula.to <= before.to &&
            afterMath[index].display === formula.display &&
            afterMath[index].delimiterLength === formula.delimiterLength &&
            afterMath[index].from ===
              transaction.changes.mapPos(formula.from, 1) &&
            afterMath[index].to === transaction.changes.mapPos(formula.to, -1),
        );
      if (!stable) {
        local = false;
        return;
      }
      // Preserve structure outside the unchanged delimiters. Pure TeX text /
      // number edits do not need another full-document structural scan.
      const mask = (text: string, formulas: MathRange[], base: number) => {
        const parts: string[] = [];
        let from = 0;
        for (const formula of formulas) {
          parts.push(text.slice(from, formula.from - base), "MATH");
          from = formula.to - base;
        }
        parts.push(text.slice(from));
        return parts.join("");
      };
      beforeText = mask(before.text, beforeMath, before.from);
      afterText = mask(after.text, afterMath, after.from);
    }
    // Plain paragraph edits are line-local. Structural Markdown, indentation,
    // table pipes and image/definition syntax can affect neighboring lines.
    const structural =
      /(?:!\[|<[!/?a-z]|-->|\?>|\]\]>|\]:|\||\$|\\[()[\]])|^\s*(?:>|`|~|#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])\s|[-=_*]{3,})|^[ \t]{4}/i;
    if (structural.test(beforeText) || structural.test(afterText))
      local = false;
  });
  return local;
}

const liveStructure = StateField.define<LiveStructure>({
  create: buildStructure,
  update: (structure, transaction) => {
    if (transaction.docChanged) {
      return canUpdateLocally(transaction)
        ? {
            ...structure,
            mapping: structure.widgetLines.size
              ? structure.mapping.composeDesc(transaction.changes)
              : ChangeSet.empty(transaction.state.doc.length).desc,
            mappedEdits: structure.widgetLines.size
              ? structure.mappedEdits + 1
              : 0,
            tree: syntaxTree(transaction.state),
          }
        : buildStructure(transaction.state);
    }
    return structure.syntaxPending &&
      syntaxTree(transaction.state) !== structure.tree
      ? buildStructure(transaction.state)
      : structure;
  },
});

function linesToBuild(state: EditorState, lineNumbers?: ReadonlySet<number>) {
  return lineNumbers
    ? [...lineNumbers]
        .sort((a, b) => a - b)
        .map((number) => state.doc.line(number))
    : Array.from({ length: state.doc.lines }, (_, index) =>
        state.doc.line(index + 1),
      );
}

function tableRowAt(
  state: EditorState,
  structure: LiveStructure,
  number: number,
) {
  const row = structure.tableRows.get(number);
  if (!row) return undefined;
  const map = (position: number) => structure.mapping.mapPos(position);
  return {
    ...row,
    from: map(row.from),
    to: map(row.to),
    tableFrom: map(row.tableFrom),
    cells: row.cells.map((cell) => ({
      ...cell,
      from: map(cell.from),
      to: map(cell.to),
      outerFrom: map(cell.outerFrom),
      outerTo: map(cell.outerTo),
    })),
  };
}

function changedLines(transaction: Transaction) {
  const lines = new Set<number>();
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (
      let number = transaction.state.doc.lineAt(fromB).number;
      number <= transaction.state.doc.lineAt(toB).number;
      number++
    )
      lines.add(number);
  });
  // Interactive widgets and table attributes carry document positions in
  // addition to their mapped Decoration ranges. Refresh only those whose
  // positions shifted, so clicking a later image/task still targets its source.
  for (const number of transaction.startState.field(liveStructure)
    .widgetLines) {
    const from = transaction.startState.doc.line(number).from;
    if (transaction.changes.mapPos(from) !== from) lines.add(number);
  }
  return lines;
}

function replaceLineDecorations(
  decorations: DecorationSet,
  state: EditorState,
  lineNumbers: ReadonlySet<number>,
  additions: DecorationSet,
) {
  for (const number of lineNumbers) {
    const line = state.doc.line(number);
    decorations = decorations.update({
      filterFrom: line.from,
      filterTo: line.to,
      filter: (from) => from < line.from || from > line.to,
    });
  }
  const add: ReturnType<Decoration["range"]>[] = [];
  additions.between(0, state.doc.length, (from, to, value) => {
    add.push(value.range(from, to));
  });
  return decorations.update({ add, sort: true });
}

/**
 * Build live-preview decorations.
 *
 * - Inactive lines: replace-hide MD markers (not CSS collapse — keeps click mapping accurate).
 * - Active lines: show markers with muted style, keep structural/inline styles.
 * - Frontmatter: no live styling.
 */
export function buildLivePreviewDecorations(
  state: EditorState,
  composing: boolean,
  imageAssets: ImageAssetMap,
  activeCell: TableCellEditTarget | null,
  tableSelection: TableSelection,
  lineNumbers?: ReadonlySet<number>,
): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const structure = state.field(liveStructure);
  const markers = structure.markers;
  const doc = asDocLines(state);
  const sel = state.selection.main;
  const active = activeLinesFromSelection(doc, sel.from, sel.to);
  if (composing) {
    active.add(doc.lineAt(sel.head).number);
  }
  // Single pass over all lines; the parsed text array feeds the frontmatter /
  // fenced-code passes and the main decoration loop, so a full rebuild is
  // one scan instead of three.
  const lines = linesToBuild(state, lineNumbers);
  const { fm, fencedCode, tableDelimiterLines } = structure;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const n = line.number;
    if (fm.has(n)) continue;

    const text = line.text;
    const base = line.from;
    const formulas = mathOnLine(state, structure, n);
    // A multiline formula is rendered by its direct StateField. Do not let
    // TeX pipes/stars/indentation turn its source into a table or list.
    if (
      formulas.some(
        (formula) =>
          formula.display || formula.from < base || formula.to > line.to,
      )
    )
      continue;
    const formulaOffsets = formulas.map((formula) => ({
      from: formula.from - base,
      to: formula.to - base,
    }));
    const isActive = active.has(n);
    const hideMarks = !isActive;
    const parsed = cachedLineParse(text, isActive);
    const references = structure.references.get(n);
    const images = references
      ? [...parsed.images, ...references].sort((a, b) => a.from - b.from)
      : parsed.images;
    const imagePlans = (
      references
        ? planLiveImageDecorations(text, isActive, images)
        : parsed.imagePlans
    ).filter((image) => !intersects(image.from, image.to, formulaOffsets));
    const codeLineKind = fencedCode[n - 1];

    const tableRow = tableRowAt(state, structure, n);
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

    const originalRule = markers.rules.get(n);
    const rule = originalRule && {
      from: structure.mapping.mapPos(originalRule.from),
      to: structure.mapping.mapPos(originalRule.to),
    };
    if (rule) {
      ranges.push(
        hideMarks
          ? Decoration.replace({ widget: new HorizontalRuleWidget() }).range(
              rule.from,
              rule.to,
            )
          : syntaxRange(rule.from, rule.to),
      );
      continue;
    }
    const originalTask = markers.tasks.get(n);
    const task = originalTask && {
      from: structure.mapping.mapPos(originalTask.from),
      to: structure.mapping.mapPos(originalTask.to),
    };
    if (task) {
      ranges.push(
        hideMarks
          ? Decoration.replace({
              widget: new TaskCheckboxWidget(
                task.from,
                state.doc
                  .sliceString(task.from + 1, task.from + 2)
                  .toLowerCase() === "x",
                state.doc.sliceString(task.to, line.to).trim(),
                state.readOnly || !state.facet(EditorView.editable),
              ),
            }).range(task.from, task.to)
          : syntaxRange(task.from, task.to),
      );
    }

    for (const image of imagePlans) {
      const resolved = imageAssetFromMap(image.source, imageAssets);
      const widget = new ImageWidget(
        image.alt,
        image.source,
        base + image.sourceFrom,
        base + image.sourceTo,
        image.width,
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
            ? task && !list.ordered
              ? hideRange(base + list.indent.length, base + list.markEnd)
              : listMarkerRange(base, base + list.markEnd, list)
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
      if (intersects(r.from, r.to, formulaOffsets)) continue;
      // Link paint is viewport-local. Its syntax markers must move with it,
      // while structural/image/table decorations remain document-wide.
      if (r.linkSource || r.kind === "link") continue;
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
  private compositionEndTimer: number | undefined;
  private compositionEpoch = 0;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.decorations = buildLivePreviewDecorations(
      view.state,
      this.composing,
      this.imageAssets,
      this.activeCell,
      this.tableSelection,
    );
  }

  update(update: ViewUpdate) {
    const oldAssets = this.imageAssets;
    const oldCell = this.activeCell;
    const oldSelection = this.tableSelection;
    // IME `compositionend` can be lost on blur / window teardown. Release the
    // bookkeeping without an extra dispatch that could discard native input.
    if (this.composing && !update.view.hasFocus) {
      this.clearComposing();
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
    const fullRebuild =
      update.state.readOnly !== update.startState.readOnly ||
      update.state.facet(EditorView.editable) !==
        update.startState.facet(EditorView.editable) ||
      (!update.docChanged &&
        update.state.field(liveStructure) !==
          update.startState.field(liveStructure)) ||
      update.transactions.some(
        (transaction) =>
          transaction.docChanged && !canUpdateLocally(transaction),
      );
    if (fullRebuild) {
      this.decorations = buildLivePreviewDecorations(
        update.state,
        this.composing,
        this.imageAssets,
        this.activeCell,
        this.tableSelection,
      );
      return;
    }
    if (!effectChanged && !update.docChanged && !update.selectionSet) return;
    const lines = new Set<number>();
    if (update.docChanged) {
      this.decorations = this.decorations.map(update.changes);
      for (const transaction of update.transactions)
        if (transaction.docChanged)
          for (const number of changedLines(transaction)) lines.add(number);
    }
    if (update.selectionSet) {
      for (const state of [update.startState, update.state])
        for (const number of activeLinesFromSelection(
          asDocLines(state),
          state.selection.main.from,
          state.selection.main.to,
        ))
          lines.add(number);
    }
    const structure = update.state.field(liveStructure);
    if (oldAssets !== this.imageAssets) {
      for (const reference of new Set([
        ...Object.keys(oldAssets),
        ...Object.keys(this.imageAssets),
      ])) {
        if (
          oldAssets[reference]?.dataUrl ===
            this.imageAssets[reference]?.dataUrl &&
          oldAssets[reference]?.error === this.imageAssets[reference]?.error
        )
          continue;
        for (const number of structure.imageLines.get(reference) ?? [])
          lines.add(number);
      }
    }
    if (
      effectChanged &&
      (oldCell !== this.activeCell || oldSelection !== this.tableSelection)
    ) {
      for (const target of [
        oldCell,
        oldSelection,
        this.activeCell,
        this.tableSelection,
      ]) {
        if (!target) continue;
        const current =
          target === oldCell || target === oldSelection
            ? update.changes.mapPos(target.tableFrom)
            : target.tableFrom;
        const original = structure.mapping.invertedDesc.mapPos(current);
        for (const number of structure.tableLines.get(original) ?? [])
          lines.add(number);
      }
    }
    if (!lines.size) return;
    if (lines.size > 128) {
      this.decorations = buildLivePreviewDecorations(
        update.state,
        this.composing,
        this.imageAssets,
        this.activeCell,
        this.tableSelection,
      );
      return;
    }
    this.decorations = replaceLineDecorations(
      this.decorations,
      update.state,
      lines,
      buildLivePreviewDecorations(
        update.state,
        this.composing,
        this.imageAssets,
        this.activeCell,
        this.tableSelection,
        lines,
      ),
    );
  }

  setComposing(view: EditorView, value: boolean) {
    this.cancelCompositionEnd();
    if (value) {
      this.composing = true;
      return;
    }
    if (!this.composing) return;
    const ownerWindow = view.dom.ownerDocument.defaultView;
    if (!ownerWindow) {
      this.composing = false;
      return;
    }
    const epoch = this.compositionEpoch;
    // CodeMirror commits pending native mutations after compositionend. An
    // eager dispatch here clears those records and can restore the old text.
    // The selection already exposes this line's syntax, so neither composition
    // event requires a redraw; subsequent native transactions update it normally.
    this.compositionEndTimer = ownerWindow.setTimeout(() => {
      this.compositionEndTimer = undefined;
      if (
        this.destroyed ||
        epoch !== this.compositionEpoch ||
        view.compositionStarted
      )
        return;
      this.composing = false;
    }, 0);
  }

  private cancelCompositionEnd() {
    this.compositionEpoch += 1;
    if (this.compositionEndTimer !== undefined) {
      this.view.dom.ownerDocument.defaultView?.clearTimeout(
        this.compositionEndTimer,
      );
      this.compositionEndTimer = undefined;
    }
  }

  clearComposing() {
    this.cancelCompositionEnd();
    this.composing = false;
  }

  destroy() {
    this.destroyed = true;
    this.clearComposing();
  }
}

export const livePreviewViewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    compositionstart(this: LivePreviewPlugin, _event, view) {
      this.setComposing(view, true);
    },
    compositionend(this: LivePreviewPlugin, _event, view) {
      this.setComposing(view, false);
    },
    blur(this: LivePreviewPlugin) {
      this.clearComposing();
    },
  },
});

/** Inline-only link paint; viewport changes never rebuild block or image layout. */
export function buildVisibleLinkDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  composing = false,
): DecorationSet {
  const structure = state.field(liveStructure);
  const tree = syntaxTree(state);
  const lines = new Map<number, Array<{ from: number; to: number }>>();
  for (const range of visibleRanges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
    for (let number = first; number <= last; number += 1) {
      const ranges = lines.get(number) ?? [];
      ranges.push(range);
      lines.set(number, ranges);
    }
  }
  const selection = state.selection.main;
  const firstActive = state.doc.lineAt(selection.from).number;
  const lastActive = state.doc.lineAt(
    selection.empty ? selection.to : Math.max(selection.from, selection.to - 1),
  ).number;
  const composingLine = composing ? state.doc.lineAt(selection.head).number : 0;
  const decorations: ReturnType<Decoration["range"]>[] = [];
  const forbidden =
    /^(?:FencedCode|CodeBlock|InlineCode|CodeText|HTMLBlock|HTMLTag|CommentBlock|Comment|ProcessingInstructionBlock|LinkReference|Image)$/;
  const inForbiddenSyntax = (position: number, side: -1 | 1): boolean => {
    let node = tree.resolveInner(position, side);
    while (node) {
      if (forbidden.test(node.name)) return true;
      if (!node.parent) break;
      node = node.parent;
    }
    return false;
  };
  for (const [number, visible] of lines) {
    if (
      structure.fm.has(number) ||
      structure.fencedCode[number - 1] ||
      structure.tableRows.has(number) ||
      structure.tableDelimiterLines.has(number) ||
      structure.structuralLines.has(number)
    )
      continue;
    const line = state.doc.line(number);
    const active =
      (number >= firstActive && number <= lastActive) ||
      number === composingLine;
    const parsed = cachedLineParse(line.text, active);
    const images = [
      ...parsed.images,
      ...(structure.references.get(number) ?? []),
    ];
    const accepted = new Map<number, boolean>();
    for (const range of parsed.inlines) {
      const source = range.linkSource;
      if (!source || range.from >= range.to) continue;
      let allowed = accepted.get(source.from);
      if (allowed === undefined) {
        const from = line.from + source.from;
        const to = line.from + source.to;
        allowed =
          source.to <= line.length &&
          to <= tree.length &&
          visible.some((part) => from < part.to && to > part.from) &&
          !intersects(source.from, source.to, images) &&
          !mathOnLine(state, structure, number).some(
            (formula) => from < formula.to && to > formula.from,
          ) &&
          !inForbiddenSyntax(from, 1) &&
          !inForbiddenSyntax(to, -1);
        accepted.set(source.from, allowed);
      }
      if (!allowed) continue;
      const from = line.from + range.from;
      const to = line.from + range.to;
      if (range.kind === "link") {
        decorations.push(
          Decoration.mark({
            class: "zmd-lp-link",
            // This is a styling marker. Click handlers resolve current source.
            attributes: { "data-zmd-link": "" },
          }).range(from, to),
        );
      } else if (range.kind === "mark") {
        // A cached line never includes a newline. Viewport-dependent replace
        // decorations must not span lines or introduce block widgets.
        decorations.push(active ? syntaxRange(from, to) : hideRange(from, to));
      }
    }
  }
  return Decoration.set(decorations, true);
}

class VisibleLinksPlugin {
  decorations: DecorationSet;
  private composing = false;

  constructor(private readonly view: EditorView) {
    this.decorations = this.build();
  }

  private build(): DecorationSet {
    this.composing =
      this.view.plugin(livePreviewViewPlugin)?.composing ?? false;
    return buildVisibleLinkDecorations(
      this.view.state,
      this.view.visibleRanges,
      this.composing,
    );
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState) ||
      update.state.field(liveStructure) !==
        update.startState.field(liveStructure) ||
      this.composing !==
        (update.view.plugin(livePreviewViewPlugin)?.composing ?? false)
    )
      this.decorations = this.build();
  }
}

export const livePreviewVisibleLinks = ViewPlugin.fromClass(
  VisibleLinksPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);

/** Live preview decorations (headings, emphasis, list, quote, link, code). */
export function livePreviewPlugin(): Extension {
  return [
    liveStructure,
    livePreviewMathDecorations,
    livePreviewBlockDecorations,
    livePreviewViewPlugin,
    livePreviewVisibleLinks,
  ];
}
