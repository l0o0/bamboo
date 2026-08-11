/// <reference lib="dom" />

import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  activeLinesFromSelection,
  frontmatterLineNumbers,
  shouldSkipLiveLine,
} from "./active-lines";
import { parseInlineL2 } from "./inline";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  parseListPrefix,
} from "./structure";
import type { DocLines, LineInfo } from "./types";

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

function buildDecorations(
  state: EditorState,
  composing: boolean,
): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  const doc = asDocLines(state);
  const sel = state.selection.main;
  const active = activeLinesFromSelection(doc, sel.from, sel.to);
  if (composing) {
    active.add(doc.lineAt(sel.head).number);
  }
  const fm = frontmatterLineNumbers(state.doc.toString());

  for (let n = 1; n <= state.doc.lines; n++) {
    if (shouldSkipLiveLine(n, active, fm)) continue;
    const line = state.doc.line(n);
    const text = line.text;
    const base = line.from;

    const heading = parseAtxHeading(text);
    if (heading) {
      if (heading.markEnd > 0) {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-hidden" }).range(
            base,
            base + heading.markEnd,
          ),
        );
      }
      ranges.push(
        Decoration.line({ class: `zmd-lp-h${heading.level}` }).range(base),
      );
    } else {
      const list = parseListPrefix(text);
      if (list) {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-hidden" }).range(
            base,
            base + list.markEnd,
          ),
        );
        ranges.push(Decoration.line({ class: "zmd-lp-list" }).range(base));
      } else {
        const quote = parseBlockQuotePrefix(text);
        if (quote) {
          ranges.push(
            Decoration.mark({ class: "zmd-lp-hidden" }).range(
              base,
              base + quote.markEnd,
            ),
          );
          ranges.push(Decoration.line({ class: "zmd-lp-quote" }).range(base));
        }
      }
    }

    const inlines = parseInlineL2(text);
    for (const r of inlines) {
      if (r.from >= r.to) continue;
      const from = base + r.from;
      const to = base + r.to;
      if (r.kind === "mark") {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-hidden" }).range(from, to),
        );
      } else if (r.kind === "strong") {
        ranges.push(
          Decoration.mark({ class: "zmd-lp-strong" }).range(from, to),
        );
      } else if (r.kind === "em") {
        ranges.push(Decoration.mark({ class: "zmd-lp-em" }).range(from, to));
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

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view.state, this.composing);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.decorations = buildDecorations(update.state, this.composing);
    }
  }

  setComposing(view: EditorView, value: boolean) {
    if (this.composing === value) return;
    this.composing = value;
    this.decorations = buildDecorations(view.state, this.composing);
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
