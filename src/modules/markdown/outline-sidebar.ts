import type { EditorOutlineItem } from "./editor-protocol";

export const OUTLINE_AUTO_HIDE_WIDTH = 680;

export function outlineIndentPx(level: number): number {
  return Math.min(44, 8 + (Math.max(1, level) - 1) * 12);
}

export function outlineVisibleAtWidth(
  expanded: boolean,
  width: number,
): boolean {
  return expanded && width >= OUTLINE_AUTO_HIDE_WIDTH;
}

export interface OutlineSidebarHandle {
  update(items: readonly EditorOutlineItem[], activeID: string | null): void;
  setActive(activeID: string | null): void;
  setExpanded(expanded: boolean): void;
  isVisible(): boolean;
  destroy(): void;
}

export function mountOutlineSidebar(options: {
  root: HTMLElement;
  sidebar: HTMLElement;
  list: HTMLElement;
  toolbarToggle: HTMLButtonElement;
  emptyLabel: string;
  getExpanded: () => boolean;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate: (item: EditorOutlineItem) => void;
}): OutlineSidebarHandle {
  const {
    root,
    sidebar,
    list,
    toolbarToggle,
    emptyLabel,
    getExpanded,
    onExpandedChange,
    onNavigate,
  } = options;
  let itemsByID = new Map<string, EditorOutlineItem>();
  let activeID: string | null = null;
  let autoHidden = false;

  const syncActive = () => {
    for (const element of list.querySelectorAll<HTMLElement>(
      "[data-outline-id]",
    )) {
      const active = element.dataset.outlineId === activeID;
      element.classList.toggle("is-active", active);
      if (active) element.setAttribute("aria-current", "location");
      else element.removeAttribute("aria-current");
    }
  };

  const syncExpanded = (expanded: boolean) => {
    root.classList.toggle("is-outline-collapsed", !expanded);
    toolbarToggle.setAttribute(
      "aria-expanded",
      String(expanded && !autoHidden),
    );
    sidebar.setAttribute("aria-hidden", String(!expanded || autoHidden));
  };

  const syncWidth = () => {
    const width = root.getBoundingClientRect().width || root.clientWidth;
    autoHidden = width > 0 && width < OUTLINE_AUTO_HIDE_WIDTH;
    root.classList.toggle("is-outline-auto-hidden", autoHidden);
    syncExpanded(getExpanded());
  };

  const setActive = (nextActiveID: string | null) => {
    activeID = nextActiveID;
    syncActive();
  };

  const update = (
    items: readonly EditorOutlineItem[],
    nextActiveID: string | null,
  ) => {
    itemsByID = new Map(items.map((item) => [item.id, item]));
    activeID = nextActiveID;
    list.replaceChildren();

    if (!items.length) {
      const empty = list.ownerDocument.createElement("div");
      empty.className = "zotero-markdown-outline-empty";
      empty.textContent = emptyLabel;
      list.appendChild(empty);
      return;
    }

    const fragment = list.ownerDocument.createDocumentFragment();
    for (const item of items) {
      const button = list.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "zotero-markdown-outline-item";
      button.dataset.outlineId = item.id;
      button.setAttribute("role", "treeitem");
      button.setAttribute("aria-level", String(item.level));
      button.title = item.text;
      button.textContent = item.text;
      button.style.paddingInlineStart = `${outlineIndentPx(item.level)}px`;
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
    syncActive();
  };

  const activateTarget = (target: EventTarget | null) => {
    const element = (target as Element | null)?.closest?.(
      "[data-outline-id]",
    ) as HTMLElement | null;
    const item = element?.dataset.outlineId
      ? itemsByID.get(element.dataset.outlineId)
      : undefined;
    if (!item) return false;
    onNavigate(item);
    return true;
  };

  const onListClick = (event: MouseEvent) => {
    activateTarget(event.target);
  };
  const onListKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!activateTarget(event.target)) return;
    event.preventDefault();
  };
  const onToolbarToggle = () => onExpandedChange(!getExpanded());

  list.addEventListener("click", onListClick);
  list.addEventListener("keydown", onListKeyDown);
  toolbarToggle.addEventListener("click", onToolbarToggle);

  const ResizeObserverCtor =
    root.ownerDocument.defaultView?.ResizeObserver || globalThis.ResizeObserver;
  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(syncWidth)
    : null;
  resizeObserver?.observe(root);
  syncWidth();
  syncExpanded(getExpanded());

  return {
    update,
    setActive,
    setExpanded: syncExpanded,
    isVisible: () => getExpanded() && !autoHidden,
    destroy: () => {
      resizeObserver?.disconnect();
      list.removeEventListener("click", onListClick);
      list.removeEventListener("keydown", onListKeyDown);
      toolbarToggle.removeEventListener("click", onToolbarToggle);
      itemsByID.clear();
    },
  };
}
