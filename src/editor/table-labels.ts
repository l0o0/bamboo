/** Plain data shared by the privileged host and the editor iframe. */
export const DEFAULT_TABLE_LABELS = {
  "insert-row-above": "Insert row above",
  "insert-row-below": "Insert row below",
  "move-row-up": "Move row up",
  "move-row-down": "Move row down",
  "delete-row": "Delete row",
  "insert-column-left": "Insert column left",
  "insert-column-right": "Insert column right",
  "move-column-left": "Move column left",
  "move-column-right": "Move column right",
  "align-default": "Default alignment",
  "align-left": "Align left",
  "align-center": "Align center",
  "align-right": "Align right",
  "clear-selection": "Clear selected cells",
  "delete-selected-row": "Delete selected row",
  "delete-selected-column": "Delete selected column",
  "drag-row": "Drag to reorder row",
  "drag-column": "Drag to reorder column",
  "append-row": "Add row below",
  "append-column": "Add column on the right",
};

export type EditorTableLabels = Record<
  keyof typeof DEFAULT_TABLE_LABELS,
  string
>;
