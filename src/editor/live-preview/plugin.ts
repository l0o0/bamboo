/// <reference lib="dom" />

import { EditorState, StateEffect, type Extension } from "@codemirror/state";
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
  frontmatterLineNumbers,
} from "./active-lines";
import { parseInlineL2 } from "./inline";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  fencedCodeLineKinds,
  parseListPrefix,
} from "./structure";
import type { DocLines, LineInfo } from "./types";
import {
  normalizeAssetReference,
  parseMarkdownImages,
} from "../../modules/markdown/images/model";
import type { ImageAssetMap } from "../../modules/markdown/editor-protocol";
import { planLiveImageDecorations } from "./images";
import { imageDebug } from "../image-debug";
import { liveTableRows, type TableAlignment } from "../table";

export const setLiveImageAssets = StateEffect.define<ImageAssetMap>();

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
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  eq(other: TableCellWidget) {
    return (
      this.value === other.value &&
      this.alignment === other.alignment &&
      this.header === other.header &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM() {
    const cell = document.createElement("span");
    cell.className = `zmd-lp-table-cell zmd-lp-table-align-${this.alignment || "default"}`;
    if (this.header) cell.classList.add("zmd-lp-table-header-cell");
    cell.dataset.zmdTableCellFrom = String(this.from);
    cell.dataset.zmdTableCellTo = String(this.to);
    cell.textContent = this.value || " ";
    return cell;
  }

  ignoreEvent(event: Event) {
    return event.type !== "click" && event.type !== "contextmenu";
  }
}

function intersects(
  from: number,
  to: number,
  ranges: Array<{ from: number; to: number }>,
) {
  return ranges.some((range) => from < range.to && to > range.from);
}

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
): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const doc = asDocLines(state);
  const sel = state.selection.main;
  const active = activeLinesFromSelection(doc, sel.from, sel.to);
  if (composing) {
    active.add(doc.lineAt(sel.head).number);
  }
  const fm = frontmatterLineNumbers(state.doc.toString());
  const fencedCode = fencedCodeLineKinds(state.doc.toString());
  const tableRows = new Map(
    liveTableRows(state).map((row) => [row.line, row] as const),
  );
  const tableDelimiterLines = new Set(
    [...tableRows.values()]
      .filter((row) => row.kind === "header")
      .map((row) => row.line + 1),
  );

  for (let n = 1; n <= state.doc.lines; n++) {
    if (fm.has(n)) continue;

    const line = state.doc.line(n);
    const text = line.text;
    const base = line.from;
    const isActive = active.has(n);
    const hideMarks = !isActive;
    const images = parseMarkdownImages(text);
    const imagePlans = planLiveImageDecorations(text, isActive);
    const codeLineKind = fencedCode[n - 1];

    const tableRow = tableRows.get(n);
    if (tableRow) {
      if (isActive) {
        ranges.push(
          Decoration.line({ class: "zmd-lp-table-source" }).range(base),
        );
      } else {
        const rowClasses = [
          "zmd-lp-table-row",
          `zmd-lp-table-${tableRow.kind}`,
        ];
        if (tableRow.isLast) rowClasses.push("zmd-lp-table-last-row");
        ranges.push(
          Decoration.line({
            attributes: {
              class: rowClasses.join(" "),
              style: `--zmd-table-columns: ${tableRow.columnCount}`,
            },
          }).range(base),
        );
        let cursor = line.from;
        tableRow.cells.forEach((cell, index) => {
          if (cursor < cell.from) ranges.push(hideRange(cursor, cell.from));
          const widget = new TableCellWidget(
            state.doc.sliceString(cell.from, cell.to),
            tableRow.alignments[index] || null,
            tableRow.kind === "header",
            cell.from,
            cell.to,
          );
          if (cell.from === cell.to) {
            ranges.push(
              Decoration.widget({ widget, side: index }).range(cell.from),
            );
          } else {
            ranges.push(
              Decoration.replace({ widget }).range(cell.from, cell.to),
            );
          }
          cursor = cell.to;
        });
        if (cursor < line.to) ranges.push(hideRange(cursor, line.to));
      }
      continue;
    }

    if (tableDelimiterLines.has(n)) {
      ranges.push(
        Decoration.line({
          class: isActive
            ? "zmd-lp-table-delimiter-source"
            : "zmd-lp-table-delimiter",
        }).range(base),
      );
      if (!isActive && text.length) ranges.push(hideRange(base, line.to));
      continue;
    }

    if (codeLineKind) {
      if (codeLineKind === "content") {
        ranges.push(
          Decoration.line({ class: "zmd-lp-code-block" }).range(base),
        );
      } else {
        ranges.push(
          Decoration.line({ class: "zmd-lp-code-fence" }).range(base),
        );
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

    const heading = parseAtxHeading(text);
    if (heading) {
      if (heading.markEnd > 0) {
        ranges.push(
          hideMarks
            ? hideRange(base, base + heading.markEnd)
            : syntaxRange(base, base + heading.markEnd),
        );
      }
      ranges.push(
        Decoration.line({ class: `zmd-lp-h${heading.level}` }).range(base),
      );
    } else {
      const list = parseListPrefix(text);
      if (list) {
        ranges.push(
          hideMarks
            ? listMarkerRange(base, base + list.markEnd, list)
            : syntaxRange(base, base + list.markEnd),
        );
        ranges.push(Decoration.line({ class: "zmd-lp-list" }).range(base));
      } else {
        const quote = parseBlockQuotePrefix(text);
        if (quote) {
          ranges.push(
            hideMarks
              ? hideRange(base, base + quote.markEnd)
              : syntaxRange(base, base + quote.markEnd),
          );
          ranges.push(Decoration.line({ class: "zmd-lp-quote" }).range(base));
        }
      }
    }

    const inlines = parseInlineL2(text);
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

  constructor(view: EditorView) {
    this.decorations = buildDecorations(
      view.state,
      this.composing,
      this.imageAssets,
    );
  }

  update(update: ViewUpdate) {
    let imageAssetsChanged = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setLiveImageAssets)) {
          this.imageAssets = effect.value;
          imageAssetsChanged = true;
        }
      }
    }
    if (
      imageAssetsChanged ||
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.decorations = buildDecorations(
        update.state,
        this.composing,
        this.imageAssets,
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
  return livePreviewViewPlugin;
}
