import type {
  EditorLinkCandidate,
  EditorLinkFilter,
  EditorLinkLabels,
} from "../modules/markdown/editor-protocol";

export const DEFAULT_LINK_LABELS: EditorLinkLabels = {
  all: "All",
  regular: "Items",
  notesAttachments: "Notes & files",
  open: "Open",
  empty: "No matching items",
  loading: "Searching…",
};

let popupSequence = 0;
const FILTERS: readonly EditorLinkFilter[] = [
  "all",
  "regular",
  "notes-attachments",
  "open",
];

export function linkCompletionPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  desiredHeight: number,
) {
  const margin = 8;
  const width = Math.max(0, Math.min(392, viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - margin - 4);
  const above = Math.max(0, anchor.top - margin - 4);
  const useBelow = below >= desiredHeight || below >= above;
  const height = Math.min(desiredHeight, useBelow ? below : above);
  return {
    width,
    height,
    left: Math.max(
      margin,
      Math.min(anchor.left, viewport.width - width - margin),
    ),
    top: Math.max(
      margin,
      Math.min(
        useBelow ? anchor.bottom + 4 : anchor.top - height - 4,
        viewport.height - height - margin,
      ),
    ),
  };
}

export interface LinkCompletionPopup {
  update(
    filter: EditorLinkFilter,
    results: readonly EditorLinkCandidate[],
    loading: boolean,
  ): void;
  destroy(): void;
}

/** The popup never dispatches an editor transaction or changes its selection. */
export function createLinkCompletionPopup(options: {
  host: HTMLElement;
  contentDOM: HTMLElement;
  labels: EditorLinkLabels;
  isComposing: () => boolean;
  focusEditor: () => void;
  anchor: () => { left: number; top: number; bottom: number } | null;
  onFilter: (filter: EditorLinkFilter) => void;
  onChoose: (candidate: EditorLinkCandidate) => void;
  onDismiss: () => void;
}): LinkCompletionPopup {
  const { host, contentDOM, labels } = options;
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  let currentFilter: EditorLinkFilter = "all";
  const selectFilter = (filter: EditorLinkFilter) => {
    currentFilter = filter;
    options.onFilter(filter);
  };
  const popup = doc.createElement("div");
  popup.className = "zmd-link-completion";
  Object.assign(popup.style, {
    position: "fixed",
    visibility: "hidden",
    zIndex: "1000",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    overflow: "hidden",
    borderRadius: "9px",
    backgroundColor: "var(--zmd-menu-bg, #fff)",
    border: "1px solid var(--zmd-menu-border, #d8dbe0)",
    color: "var(--zmd-menu-text, #24272d)",
    boxShadow: "0 8px 24px var(--zmd-menu-shadow, rgb(0 0 0 / 16%))",
    font: "12px/1.4 system-ui, sans-serif",
  });
  const filters = doc.createElement("div");
  filters.className = "zmd-link-filters";
  filters.setAttribute("role", "group");
  Object.assign(filters.style, {
    display: "flex",
    flexShrink: "0",
    gap: "2px",
    padding: "5px",
    borderBottom: "1px solid var(--zmd-menu-border, #d8dbe0)",
  });
  const filterButtons = FILTERS.map((filter) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.dataset.linkFilter = filter;
    button.textContent =
      filter === "notes-attachments" ? labels.notesAttachments : labels[filter];
    button.title = button.textContent;
    Object.assign(button.style, {
      flex: "1 1 0",
      minWidth: "0",
      padding: "5px 3px",
      border: "0",
      borderRadius: "5px",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      fontSize: "11px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      cursor: "pointer",
    });
    button.addEventListener("click", () => {
      if (!options.isComposing()) selectFilter(filter);
    });
    filters.append(button);
    return button;
  });
  const list = doc.createElement("div");
  list.className = "zmd-link-results";
  list.setAttribute("role", "listbox");
  list.id = `zmd-link-options-${++popupSequence}`;
  const previousAria = new Map(
    [
      "aria-controls",
      "aria-expanded",
      "aria-autocomplete",
      "aria-activedescendant",
    ].map((name) => [name, contentDOM.getAttribute(name)]),
  );
  contentDOM.setAttribute("aria-controls", list.id);
  contentDOM.setAttribute("aria-expanded", "true");
  contentDOM.setAttribute("aria-autocomplete", "list");
  Object.assign(list.style, {
    minHeight: "0",
    overflow: "auto",
    padding: "4px",
  });
  const status = doc.createElement("div");
  status.className = "zmd-link-status";
  status.setAttribute("role", "status");
  Object.assign(status.style, {
    padding: "15px 10px",
    color: "var(--zmd-menu-disabled, #737985)",
  });
  popup.append(filters, list);
  host.append(popup);
  let results: readonly EditorLinkCandidate[] = [];
  let activeIndex = 0;
  let rowButtons: HTMLButtonElement[] = [];
  let destroyed = false;
  let frame: number | null = null;

  const position = () => {
    frame = null;
    if (destroyed) return;
    const anchor = options.anchor();
    if (!anchor) {
      options.onDismiss();
      return;
    }
    const desiredHeight = Math.min(
      302,
      Math.max(72, filters.offsetHeight + list.scrollHeight + 2),
    );
    const box = linkCompletionPosition(
      anchor,
      { width: win.innerWidth, height: win.innerHeight },
      desiredHeight,
    );
    popup.style.width = `${box.width}px`;
    popup.style.maxHeight = `${box.height}px`;
    popup.style.left = `${box.left}px`;
    popup.style.top = `${box.top}px`;
    popup.style.visibility = "visible";
  };
  const schedulePosition = () => {
    if (frame === null && !destroyed)
      frame = win.requestAnimationFrame(position);
  };
  const updateActive = (scroll = false) => {
    contentDOM.removeAttribute("aria-activedescendant");
    rowButtons.forEach((button, index) => {
      const active = index === activeIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      if (active) contentDOM.setAttribute("aria-activedescendant", button.id);
      button.style.backgroundColor = active
        ? "var(--zmd-menu-hover, #eef1f5)"
        : "transparent";
      if (active && scroll) button.scrollIntoView({ block: "nearest" });
    });
  };
  const onMouseDown = (event: MouseEvent) => {
    // Keep the native editor selection and any query alias while choosing a filter.
    if ((event.target as Element | null)?.closest("button"))
      event.preventDefault();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.target || host.contains(event.target as Node)) return;
    options.onDismiss();
  };
  const onWindowBlur = () => options.onDismiss();
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      options.isComposing() ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.shiftKey && event.key !== "Tab")
    )
      return;
    const focusedFilter = filterButtons.indexOf(
      doc.activeElement as HTMLButtonElement,
    );
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Escape") {
      consume();
      options.onDismiss();
      options.focusEditor();
      return;
    }
    if (event.key === "Tab") {
      consume();
      const next =
        (FILTERS.indexOf(currentFilter) +
          (event.shiftKey ? -1 : 1) +
          FILTERS.length) %
        FILTERS.length;
      selectFilter(FILTERS[next]);
      options.focusEditor();
      return;
    }
    if (focusedFilter >= 0) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        consume();
        const next =
          (focusedFilter +
            (event.key === "ArrowRight" ? 1 : -1) +
            FILTERS.length) %
          FILTERS.length;
        filterButtons[next].focus();
        selectFilter(FILTERS[next]);
        return;
      } else if (event.key === " ") {
        consume();
        selectFilter(FILTERS[focusedFilter]);
        return;
      }
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      consume();
      if (focusedFilter >= 0) options.focusEditor();
      if (!results.length) return;
      activeIndex =
        (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
        results.length;
      updateActive(true);
    } else if (event.key === "Enter") {
      consume();
      if (focusedFilter >= 0) options.focusEditor();
      if (results.length) options.onChoose(results[activeIndex]);
    }
  };
  popup.addEventListener("mousedown", onMouseDown);
  host.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("pointerdown", onPointerDown);
  // Scroll inside the list should not relayout the popup itself.
  const onScroll = (event: Event) => {
    if (!popup.contains(event.target as Node)) schedulePosition();
  };
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", schedulePosition);
  win.addEventListener("blur", onWindowBlur);

  return {
    update(filter, candidates, loading) {
      currentFilter = filter;
      results = loading ? [] : candidates;
      activeIndex = 0;
      filterButtons.forEach((button, index) => {
        const selected = FILTERS[index] === filter;
        button.setAttribute("aria-pressed", String(selected));
        button.style.backgroundColor = selected
          ? "var(--zmd-menu-hover, #eef1f5)"
          : "transparent";
        button.style.fontWeight = selected ? "600" : "400";
      });
      list.replaceChildren();
      list.setAttribute("aria-busy", String(loading));
      rowButtons = [];
      for (const candidate of results) {
        const button = doc.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.setAttribute("role", "option");
        button.id = `${list.id}-${rowButtons.length}`;
        const title = candidate.heading
          ? `${candidate.title} › ${candidate.heading}`
          : candidate.title;
        const kind = candidate.kindLabel || candidate.kind;
        const metadata = candidate.author
          ? `${kind} · ${candidate.author}`
          : kind;
        button.title = `${title} · ${metadata} [${candidate.key}]`;
        Object.assign(button.style, {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          minHeight: "40px",
          padding: "6px 8px",
          border: "0",
          borderRadius: "5px",
          background: "transparent",
          color: "inherit",
          textAlign: "start",
          font: "inherit",
          cursor: "pointer",
        });
        const icon = doc.createElement("img");
        icon.className = "zmd-link-icon";
        icon.alt = "";
        icon.width = icon.height = 16;
        icon.draggable = false;
        Object.assign(icon.style, {
          width: "16px",
          height: "16px",
          flex: "0 0 16px",
          objectFit: "contain",
        });
        icon.style.setProperty("-moz-context-properties", "fill, fill-opacity");
        icon.style.setProperty("fill", "currentColor");
        if (candidate.icon) icon.src = candidate.icon;
        else icon.style.visibility = "hidden";
        const copy = doc.createElement("span");
        Object.assign(copy.style, {
          minWidth: "0",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        });
        const titleEl = doc.createElement("span");
        titleEl.textContent = title;
        Object.assign(titleEl.style, {
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        });
        const detail = doc.createElement("span");
        detail.textContent = metadata;
        Object.assign(detail.style, {
          color: "var(--zmd-menu-disabled, #737985)",
          fontSize: "10px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        });
        copy.append(titleEl, detail);
        button.append(icon, copy);
        const index = rowButtons.length;
        button.addEventListener("pointermove", () => {
          if (!options.isComposing()) {
            activeIndex = index;
            updateActive();
          }
        });
        button.addEventListener("click", () => {
          if (!options.isComposing()) options.onChoose(candidate);
        });
        list.append(button);
        rowButtons.push(button);
      }
      if (!results.length) {
        status.textContent = loading ? labels.loading : labels.empty;
        list.append(status);
      }
      updateActive();
      // Search can start in a CodeMirror update listener: defer layout reads.
      schedulePosition();
    },
    destroy() {
      destroyed = true;
      if (frame !== null) win.cancelAnimationFrame(frame);
      popup.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("resize", schedulePosition);
      win.removeEventListener("blur", onWindowBlur);
      popup.remove();
      for (const [name, value] of previousAria) {
        if (value === null) contentDOM.removeAttribute(name);
        else contentDOM.setAttribute(name, value);
      }
    },
  };
}
