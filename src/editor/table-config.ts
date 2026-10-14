import { Facet } from "@codemirror/state";
import { DEFAULT_TABLE_LABELS, type EditorTableLabels } from "./table-labels";

export const editorTableLabels = Facet.define<
  Partial<EditorTableLabels>,
  EditorTableLabels
>({
  combine: (values) => Object.assign({}, DEFAULT_TABLE_LABELS, ...values),
});
