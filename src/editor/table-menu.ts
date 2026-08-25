import type { TableAction, TableTarget } from "./table-operations";
import type { TableSelectionAction } from "./table-operations";
import type { TableSelection } from "./table-selection";

export type TableMenuAction =
  TableAction | TableSelectionAction | "copy" | "cut" | "paste";

export interface TableMenuItem {
  action: TableMenuAction;
  label: string;
  disabled: boolean;
  checked?: boolean;
}

export type TableMenuGroups = TableMenuItem[][];

const rowItems: Array<[TableAction, string]> = [
  ["insert-row-above", "在上方插入行"],
  ["insert-row-below", "在下方插入行"],
  ["move-row-up", "向上移动行"],
  ["move-row-down", "向下移动行"],
  ["delete-row", "删除行"],
];

const columnItems: Array<[TableAction, string]> = [
  ["insert-column-left", "在左侧插入列"],
  ["insert-column-right", "在右侧插入列"],
  ["move-column-left", "向左移动列"],
  ["move-column-right", "向右移动列"],
  ["delete-column", "删除列"],
];

const alignmentItems: Array<[TableAction, string]> = [
  ["align-default", "默认对齐"],
  ["align-left", "左对齐"],
  ["align-center", "居中对齐"],
  ["align-right", "右对齐"],
];

function alignmentFor(action: TableMenuAction) {
  if (action === "align-left") return "left";
  if (action === "align-center") return "center";
  if (action === "align-right") return "right";
  return null;
}

export function tableMenuItems(
  target: TableTarget,
  readOnly: boolean,
  selection: TableSelection = null,
  clipboard: Partial<Record<"copy" | "cut" | "paste", boolean>> = {},
): TableMenuGroups {
  const header = target.rowIndex === 0;
  const firstBody = target.rowIndex === 1;
  const lastBody = target.rowIndex === target.bodyRowCount;
  const disable = (action: TableAction) => {
    if (readOnly) return true;
    if (action === "move-row-up") return header || firstBody;
    if (action === "move-row-down") return header || lastBody;
    if (action === "delete-row") return header;
    if (action === "delete-column") return target.columnCount <= 1;
    if (action === "move-column-left" && target.columnIndex === 0) {
      return true;
    }
    if (
      action === "move-column-right" &&
      target.columnIndex >= target.columnCount - 1
    ) {
      return true;
    }
    return false;
  };
  const map = (items: Array<[TableAction, string]>) =>
    items.map(([action, label]) => ({
      action,
      label,
      disabled: disable(action),
      ...(action.startsWith("align-")
        ? { checked: alignmentFor(action) === target.alignment }
        : {}),
    }));
  if (selection) {
    const clipboardItems: TableMenuItem[] = [
      ["copy", "复制"],
      ["cut", "剪切"],
      ["paste", "粘贴"],
    ].map(([action, label]) => ({
      action: action as "copy" | "cut" | "paste",
      label,
      disabled:
        readOnly || clipboard[action as "copy" | "cut" | "paste"] === false,
    }));
    const selectionItems: TableMenuItem[] = [
      ["clear-selection", "清空选中的单元格"],
      [
        "delete-selection",
        selection.kind === "row" ? "删除选中的行" : "删除选中的列",
      ],
    ].map(([action, label]) => ({
      action: action as TableSelectionAction,
      label,
      disabled:
        readOnly ||
        (action === "delete-selection" &&
          (selection.kind === "row"
            ? selection.rowIndex < 1 || target.bodyRowCount < 1
            : target.columnCount <= 1)),
    }));
    const selectedGroups =
      selection.kind === "row"
        ? [
            clipboardItems,
            map(rowItems),
            selectionItems,
            [
              {
                action: "align-selection-default" as const,
                label: "默认对齐",
                disabled: readOnly,
                checked: false,
              },
              {
                action: "align-selection-left" as const,
                label: "左对齐",
                disabled: readOnly,
                checked: false,
              },
              {
                action: "align-selection-center" as const,
                label: "居中对齐",
                disabled: readOnly,
                checked: false,
              },
              {
                action: "align-selection-right" as const,
                label: "右对齐",
                disabled: readOnly,
                checked: false,
              },
            ],
          ]
        : [
            clipboardItems,
            map(columnItems),
            selectionItems,
            [
              {
                action: "align-selection-default" as const,
                label: "默认对齐",
                disabled: readOnly,
                checked: target.alignment === null,
              },
              {
                action: "align-selection-left" as const,
                label: "左对齐",
                disabled: readOnly,
                checked: target.alignment === "left",
              },
              {
                action: "align-selection-center" as const,
                label: "居中对齐",
                disabled: readOnly,
                checked: target.alignment === "center",
              },
              {
                action: "align-selection-right" as const,
                label: "右对齐",
                disabled: readOnly,
                checked: target.alignment === "right",
              },
            ],
          ];
    return selectedGroups;
  }
  return [map(rowItems), map(columnItems), map(alignmentItems)];
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
