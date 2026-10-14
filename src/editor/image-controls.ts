import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorImageLabels } from "../modules/markdown/editor-protocol";
import {
  MAX_DISPLAY_IMAGE_WIDTH,
  parseMarkdownImages,
  serializeImageReference,
} from "../modules/markdown/images/model";
import { showImageViewer } from "../modules/markdown/image-viewer";

const defaultLabels: EditorImageLabels = {
  toolbar: "Image size",
  width: "Width",
  small: "Small",
  medium: "Medium",
  large: "Large",
  auto: "Auto",
  original: "View original",
  close: "Close image",
  resize: "Resize image (arrow keys, Shift for larger steps)",
};

export function imageControls(labels: EditorImageLabels = defaultLabels) {
  return [
    imageControlsTheme,
    ViewPlugin.define((view) => new ImageControls(view, labels)),
  ];
}

class ImageControls {
  private readonly toolbar: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly sizeButtons: HTMLButtonElement[] = [];
  private selectedFrom: number | null = null;
  private referenceCache: {
    state: EditorView["state"];
    from: number;
    image: ReturnType<typeof parseMarkdownImages>[number] | null;
  } | null = null;
  private image: HTMLImageElement | null = null;
  private drag: {
    x: number;
    y: number;
    width: number;
    ratio: number;
    sx: number;
    sy: number;
    attribute: string | null;
    next: number;
  } | null = null;
  private closeViewer?: () => void;
  private readonly win: Window;

  constructor(
    private readonly view: EditorView,
    private readonly labels: EditorImageLabels,
  ) {
    const doc = view.dom.ownerDocument;
    this.win = doc.defaultView!;
    this.toolbar = doc.createElement("div");
    this.toolbar.className = "zmd-image-controls";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", labels.toolbar);
    this.toolbar.hidden = true;
    this.frame = doc.createElement("div");
    this.frame.className = "zmd-image-selection";
    this.frame.hidden = true;
    const addButton = (text: string, action: () => void) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", action);
      this.toolbar.append(button);
      return button;
    };
    for (const [text, width] of [
      [labels.small, 240],
      [labels.medium, 480],
      [labels.large, 720],
      [labels.auto, undefined],
    ] as const) {
      const button = addButton(text, () => this.commit(width));
      button.dataset.width = width === undefined ? "auto" : String(width);
      this.sizeButtons.push(button);
    }
    const widthLabel = doc.createElement("label");
    widthLabel.textContent = labels.width;
    this.input = doc.createElement("input");
    this.input.type = "number";
    this.input.min = "1";
    this.input.max = String(MAX_DISPLAY_IMAGE_WIDTH);
    this.input.step = "1";
    this.input.setAttribute("aria-label", `${labels.width} (px)`);
    this.input.addEventListener("change", () => {
      if (this.input.checkValidity() && this.input.value)
        this.commit(Number(this.input.value));
      else this.measure();
    });
    widthLabel.append(this.input, "px");
    this.toolbar.append(widthLabel);
    addButton(labels.original, () => this.openOriginal());
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = doc.createElement("button");
      handle.type = "button";
      handle.className = `zmd-image-resize is-${corner}`;
      handle.setAttribute("aria-label", labels.resize);
      handle.title = labels.resize;
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !this.image || view.state.readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = this.image.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        this.drag = {
          x: event.clientX,
          y: event.clientY,
          width: rect.width,
          next: rect.width,
          ratio: rect.width / rect.height,
          sx: corner.endsWith("e") ? 1 : -1,
          sy: corner.startsWith("s") ? 1 : -1,
          attribute: this.image.getAttribute("width"),
        };
        handle.setPointerCapture?.(event.pointerId);
      });
      handle.addEventListener("keydown", (event) => {
        if (!event.key.startsWith("Arrow") || !this.image) return;
        event.preventDefault();
        event.stopPropagation();
        const direction =
          event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
        this.commit(
          Math.max(
            1,
            Math.min(
              MAX_DISPLAY_IMAGE_WIDTH,
              Number(this.input.value) + direction * (event.shiftKey ? 10 : 1),
            ),
          ),
        );
      });
      this.frame.append(handle);
    }
    view.dom.append(this.frame, this.toolbar);
    view.dom.addEventListener("pointerdown", this.onPointerDown, true);
    view.dom.addEventListener("focusin", this.onFocus);
    view.dom.addEventListener("dblclick", this.onDoubleClick, true);
    view.dom.addEventListener("keydown", this.onKeyDown, true);
    doc.addEventListener("pointerdown", this.onOutsidePointer, true);
    this.win.addEventListener("pointermove", this.onPointerMove);
    this.win.addEventListener("pointerup", this.onPointerUp);
    this.win.addEventListener("pointercancel", this.onPointerCancel);
    this.win.addEventListener("scroll", this.measure, true);
    this.win.addEventListener("resize", this.measure);
    this.win.addEventListener("blur", this.onPointerCancel);
  }

  private reference() {
    if (
      this.selectedFrom === null ||
      this.selectedFrom > this.view.state.doc.length
    )
      return null;
    const state = this.view.state;
    if (
      this.referenceCache?.state === state &&
      this.referenceCache.from === this.selectedFrom
    )
      return this.referenceCache.image;
    const image =
      parseMarkdownImages(state.doc.toString()).find(
        (entry) => entry.from === this.selectedFrom,
      ) ?? null;
    this.referenceCache = { state, from: this.selectedFrom, image };
    return image;
  }

  private select(image: HTMLImageElement) {
    const wrapper = image.closest<HTMLElement>(".zmd-lp-image");
    if (!wrapper || !image.complete || !image.naturalWidth) return;
    this.cancelDrag();
    this.selectedFrom = Number(wrapper.dataset.zmdImageFrom);
    this.image = image;
    this.measure();
  }

  private onPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    const image = target.closest<HTMLImageElement>(".zmd-lp-image img");
    if (!image || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.select(image);
    image.focus({ preventScroll: true });
  };
  private onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (target.matches(".zmd-lp-image img"))
      this.select(target as HTMLImageElement);
  };
  private onDoubleClick = (event: MouseEvent) => {
    if ((event.target as Element).closest(".zmd-lp-image")) this.clear();
  };
  private onOutsidePointer = (event: PointerEvent) => {
    const target = event.target as Node;
    if (
      !this.toolbar.contains(target) &&
      !this.frame.contains(target) &&
      !(target as Element).closest?.(".zmd-lp-image, .zmd-image-viewer")
    )
      this.clear();
  };
  private onKeyDown = (event: KeyboardEvent) => {
    if (this.selectedFrom === null) return;
    const target = event.target as HTMLElement;
    if (target.closest(".zmd-image-viewer")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.drag) this.cancelDrag();
      else {
        this.clear();
        this.view.focus();
      }
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      target.matches(".zmd-lp-image img")
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.view.state.readOnly) this.openOriginal();
      else this.sizeButtons[0].focus();
    } else if (this.toolbar.contains(target)) {
      // Inputs and toolbar buttons own their keys, not the document keymap.
      event.stopPropagation();
      if (event.key === "Enter" && target === this.input) {
        event.preventDefault();
        if (this.input.value && this.input.checkValidity())
          this.commit(Number(this.input.value));
      }
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || !this.image) return;
    event.preventDefault();
    const delta =
      (drag.sx * (event.clientX - drag.x) +
        (drag.sy * (event.clientY - drag.y)) / drag.ratio) /
      (1 + 1 / drag.ratio ** 2);
    drag.next = Math.round(
      Math.min(MAX_DISPLAY_IMAGE_WIDTH, Math.max(48, drag.width + delta)),
    );
    this.image.width = drag.next;
    this.input.value = String(drag.next);
    this.measure();
  };
  private onPointerUp = () => {
    const drag = this.drag;
    if (!drag) return;
    this.cancelDrag();
    if (Math.abs(drag.next - drag.width) >= 1) this.commit(drag.next);
  };
  private onPointerCancel = () => this.cancelDrag();
  private cancelDrag() {
    if (this.drag && this.image) {
      if (this.drag.attribute === null) this.image.removeAttribute("width");
      else this.image.setAttribute("width", this.drag.attribute);
    }
    this.drag = null;
    this.measure();
  }

  private commit(width?: number) {
    if (this.view.state.readOnly) return;
    const reference = this.reference();
    if (!reference || (width === undefined && reference.syntax !== "html"))
      return;
    const insert = serializeImageReference(reference, width);
    if (
      insert === this.view.state.doc.sliceString(reference.from, reference.to)
    )
      return;
    this.view.dispatch({
      changes: { from: reference.from, to: reference.to, insert },
      annotations: isolateHistory.of("full"),
      userEvent: "input.image.resize",
    });
    this.measure();
  }

  private openOriginal() {
    if (!this.image) return;
    this.cancelDrag();
    this.closeViewer?.();
    this.closeViewer = showImageViewer(this.image, this.view.dom, this.labels);
  }
  private clear() {
    this.cancelDrag();
    this.selectedFrom = null;
    this.referenceCache = null;
    this.image = null;
    this.toolbar.hidden = true;
    this.frame.hidden = true;
  }

  private measure = () => {
    if (this.selectedFrom === null) return;
    this.view.requestMeasure({
      key: this,
      read: () => {
        const image = this.view.dom.querySelector<HTMLImageElement>(
          `[data-zmd-image-from="${this.selectedFrom}"] img`,
        );
        if (!image) return null;
        return {
          image,
          rect: image.getBoundingClientRect(),
          scroll: this.view.scrollDOM.getBoundingClientRect(),
          toolbar: this.toolbar.getBoundingClientRect(),
        };
      },
      write: (measurement) => {
        const reference = this.reference();
        if (!measurement || !reference) {
          this.clear();
          return;
        }
        const { image, rect, scroll, toolbar } = measurement;
        this.image = image;
        const offscreen = rect.bottom < scroll.top || rect.top > scroll.bottom;
        this.toolbar.hidden = offscreen;
        this.frame.hidden = offscreen || this.view.state.readOnly;
        Object.assign(this.frame.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        const toolbarWidth = toolbar.width || 410;
        Object.assign(this.toolbar.style, {
          left: `${Math.max(8, Math.min(rect.left, this.win.innerWidth - toolbarWidth - 8))}px`,
          top: `${Math.max(8, Math.min(rect.top > scroll.top + 48 ? rect.top - (toolbar.height || 36) - 8 : rect.bottom + 8, this.win.innerHeight - (toolbar.height || 36) - 8))}px`,
        });
        if (this.input.ownerDocument.activeElement !== this.input)
          this.input.value = String(
            this.drag?.next ?? reference.width ?? Math.round(rect.width),
          );
        this.input.disabled = this.view.state.readOnly;
        for (const button of this.sizeButtons) {
          button.disabled = this.view.state.readOnly;
          button.setAttribute(
            "aria-pressed",
            String(
              button.dataset.width ===
                (reference.width ? String(reference.width) : "auto"),
            ),
          );
        }
      },
    });
  };

  update(update: ViewUpdate) {
    if (this.selectedFrom === null) return;
    if (update.docChanged) {
      this.cancelDrag();
      this.selectedFrom = update.changes.mapPos(this.selectedFrom, -1);
    }
    if (update.state.readOnly) this.cancelDrag();
    if (update.selectionSet && !update.docChanged) this.clear();
    else this.measure();
  }

  destroy() {
    this.drag = null;
    this.selectedFrom = null;
    this.closeViewer?.();
    this.toolbar.remove();
    this.frame.remove();
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown, true);
    this.view.dom.removeEventListener("focusin", this.onFocus);
    this.view.dom.removeEventListener("dblclick", this.onDoubleClick, true);
    this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
    this.view.dom.ownerDocument.removeEventListener(
      "pointerdown",
      this.onOutsidePointer,
      true,
    );
    this.win.removeEventListener("pointermove", this.onPointerMove);
    this.win.removeEventListener("pointerup", this.onPointerUp);
    this.win.removeEventListener("pointercancel", this.onPointerCancel);
    this.win.removeEventListener("scroll", this.measure, true);
    this.win.removeEventListener("resize", this.measure);
    this.win.removeEventListener("blur", this.onPointerCancel);
  }
}

const imageControlsTheme = EditorView.baseTheme({
  ".zmd-image-controls": {
    position: "fixed",
    zIndex: "70",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    padding: "4px",
    maxWidth: "calc(100vw - 16px)",
    boxSizing: "border-box",
    border: "1px solid var(--zmd-menu-border)",
    borderRadius: "6px",
    backgroundColor: "var(--zmd-menu-bg)",
    color: "var(--zmd-menu-text)",
    boxShadow: "var(--zmd-menu-shadow)",
    font: "13px system-ui, sans-serif",
  },
  ".zmd-image-controls[hidden], .zmd-image-selection[hidden]": {
    display: "none",
  },
  ".zmd-image-controls button": {
    border: "0",
    borderRadius: "4px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    minHeight: "28px",
    padding: "4px 8px",
    cursor: "pointer",
  },
  ".zmd-image-controls button:hover, .zmd-image-controls button[aria-pressed=true]":
    { backgroundColor: "var(--zmd-menu-hover)" },
  ".zmd-image-controls button:disabled, .zmd-image-controls input:disabled": {
    opacity: "0.45",
    cursor: "default",
  },
  ".zmd-image-controls label": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 4px",
  },
  ".zmd-image-controls input": {
    width: "64px",
    minWidth: "0",
    padding: "3px 4px",
    border: "1px solid var(--zmd-menu-border)",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
  },
  ".zmd-image-controls :focus-visible, .zmd-image-resize:focus-visible, .zmd-lp-image img:focus-visible":
    { outline: "2px solid var(--zmd-menu-check)", outlineOffset: "2px" },
  ".zmd-image-selection": {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "69",
    outline: "1px solid var(--zmd-menu-check)",
  },
  ".zmd-image-resize": {
    position: "absolute",
    width: "14px",
    height: "14px",
    minWidth: "0",
    padding: "0",
    border: "2px solid var(--zmd-menu-check)",
    backgroundColor: "var(--zmd-menu-bg)",
    borderRadius: "3px",
    pointerEvents: "auto",
    touchAction: "none",
  },
  ".zmd-image-resize.is-nw": {
    left: "-7px",
    top: "-7px",
    cursor: "nwse-resize",
  },
  ".zmd-image-resize.is-ne": {
    right: "-7px",
    top: "-7px",
    cursor: "nesw-resize",
  },
  ".zmd-image-resize.is-sw": {
    left: "-7px",
    bottom: "-7px",
    cursor: "nesw-resize",
  },
  ".zmd-image-resize.is-se": {
    right: "-7px",
    bottom: "-7px",
    cursor: "nwse-resize",
  },
});
