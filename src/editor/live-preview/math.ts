import { EditorView, WidgetType } from "@codemirror/view";
import { hasMathTag, renderMath } from "../../modules/markdown/math";
import type { MathRange } from "./math-syntax";

/** The browser renders MathML; trusted HTML/link/image TeX commands stay off. */
export class MathWidget extends WidgetType {
  constructor(readonly formula: MathRange) {
    super();
  }

  eq(other: MathWidget): boolean {
    return (
      this.formula.content === other.formula.content &&
      this.formula.display === other.formula.display &&
      this.formula.from === other.formula.from &&
      this.formula.to === other.formula.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const display = this.formula.display || hasMathTag(this.formula.content);
    const dom = view.dom.ownerDocument.createElement(display ? "div" : "span");
    dom.className = `zmd-lp-math${display ? " zmd-lp-math-display" : ""}`;
    dom.contentEditable = "false";
    dom.dataset.zmdMathFrom = String(this.formula.from);
    dom.dataset.zmdMathTo = String(this.formula.to);
    dom.style.cssText = display
      ? "display:block;text-align:center;overflow-x:auto;max-width:100%;padding:.5em 0;"
      : "display:inline-block;vertical-align:middle;max-width:100%;";
    dom.innerHTML = renderMath(this.formula.content, this.formula.display);
    dom.addEventListener("mousedown", (event) => {
      if ((event as MouseEvent).button !== 0 || view.state.readOnly) return;
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.formula.from + this.formula.delimiterLength },
      });
      view.focus();
    });
    return dom;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
