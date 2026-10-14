import type {
  TableAction,
  TableTarget,
  TableSelectionAction,
} from "./table-operations";
import type { TableSelection } from "./table-selection";
import { DEFAULT_TABLE_LABELS, type EditorTableLabels } from "./table-labels";

export type TableMenuAction = TableAction | TableSelectionAction;

export interface TableMenuItem {
  action: TableMenuAction;
  label: string;
  disabled: boolean;
  checked?: boolean;
}

export type TableMenuGroups = TableMenuItem[][];
type LabeledAction = TableAction & keyof EditorTableLabels;
const rowItems: LabeledAction[] = [
  "insert-row-above",
  "insert-row-below",
  "move-row-up",
  "move-row-down",
  "delete-row",
];
const columnItems: LabeledAction[] = [
  "insert-column-left",
  "insert-column-right",
  "move-column-left",
  "move-column-right",
];
const alignmentItems: LabeledAction[] = [
  "align-default",
  "align-left",
  "align-center",
  "align-right",
];

function alignmentFor(action: string) {
  if (action.endsWith("-left")) return "left";
  if (action.endsWith("-center")) return "center";
  if (action.endsWith("-right")) return "right";
  return null;
}

export function tableMenuItems(
  target: TableTarget,
  readOnly: boolean,
  selection: TableSelection = null,
  labels: EditorTableLabels = DEFAULT_TABLE_LABELS,
): TableMenuGroups {
  const header = target.rowIndex === 0;
  const disable = (action: TableAction) => {
    if (readOnly) return true;
    if (action === "move-row-up") return header || target.rowIndex === 1;
    if (action === "move-row-down")
      return header || target.rowIndex === target.bodyRowCount;
    if (action === "delete-row") return header;
    if (action === "move-column-left") return target.columnIndex === 0;
    if (action === "move-column-right")
      return target.columnIndex >= target.columnCount - 1;
    return false;
  };
  const map = (actions: LabeledAction[]): TableMenuItem[] =>
    actions.map((action) => ({
      action,
      label: labels[action],
      disabled: disable(action),
      ...(action.startsWith("align-")
        ? { checked: alignmentFor(action) === target.alignment }
        : {}),
    }));
  if (!selection) return [map(rowItems), map(columnItems), map(alignmentItems)];
  const row = selection.kind === "row";
  return [
    // The selected row already has a delete command in the selection group.
    map(
      row ? rowItems.filter((action) => action !== "delete-row") : columnItems,
    ),
    [
      {
        action: "clear-selection",
        label: labels["clear-selection"],
        disabled: readOnly,
      },
      {
        action: "delete-selection",
        label: labels[row ? "delete-selected-row" : "delete-selected-column"],
        disabled:
          readOnly ||
          (row
            ? selection.rowIndex < 1 || target.bodyRowCount < 1
            : target.columnCount <= 1),
      },
    ],
    alignmentItems.map((action) => ({
      action: action.replace(
        "align-",
        "align-selection-",
      ) as TableSelectionAction,
      label: labels[action],
      disabled: readOnly,
      checked: !row && alignmentFor(action) === target.alignment,
    })),
  ];
}

export interface TableContextMenuOptions {
  document: Document;
  parent: HTMLElement;
  onAction: (action: TableMenuAction) => void;
}

export interface TableContextMenu {
  open: (x: number, y: number, groups: TableMenuGroups) => void;
  close: () => void;
  destroy: () => void;
  element: HTMLElement;
}

export function createTableContextMenu(
  options: TableContextMenuOptions,
): TableContextMenu {
  const menu = options.document.createElement("div");
  menu.className = "zmd-table-context-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  const onPointerDown = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const open = (x: number, y: number, groups: TableMenuGroups) => {
    menu.replaceChildren();
    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        const separator = options.document.createElement("div");
        separator.className = "zmd-table-context-separator";
        menu.appendChild(separator);
      }
      for (const item of group) {
        const button = options.document.createElement("button");
        button.type = "button";
        button.className = "zmd-table-context-item";
        button.textContent = item.label;
        button.disabled = item.disabled;
        button.setAttribute("role", "menuitem");
        if (item.checked) {
          button.setAttribute("aria-checked", "true");
          button.classList.add("is-checked");
        }
        button.addEventListener("click", () => {
          if (!item.disabled) options.onAction(item.action);
          close();
        });
        menu.appendChild(button);
      }
    });
    menu.hidden = false;
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    const position = () => {
      const maxX = options.document.defaultView
        ? options.document.defaultView.innerWidth - menu.offsetWidth - 4
        : x;
      const maxY = options.document.defaultView
        ? options.document.defaultView.innerHeight - menu.offsetHeight - 4
        : y;
      menu.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
      menu.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
    };
    if (options.document.defaultView) {
      options.document.defaultView.requestAnimationFrame(position);
    } else {
      position();
    }
  };
  options.parent.appendChild(menu);
  options.document.addEventListener("pointerdown", onPointerDown);
  options.document.addEventListener("keydown", onKeyDown);
  return {
    open,
    close,
    destroy() {
      close();
      options.document.removeEventListener("pointerdown", onPointerDown);
      options.document.removeEventListener("keydown", onKeyDown);
      menu.remove();
    },
    element: menu,
  };
}
