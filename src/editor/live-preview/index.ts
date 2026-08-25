import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";

/** Enable line-level live preview decorations when `enabled` is true. */
export function livePreviewWhen(enabled: boolean): Extension {
  return enabled ? livePreviewPlugin() : [];
}

export { livePreviewPlugin };
export { setLiveImageAssets, setLiveTableCellEdit } from "./plugin";
export {
  activeLinesFromSelection,
  frontmatterLineNumbersFromLines,
} from "./active-lines";
export {
  parseAtxHeading,
  parseListPrefix,
  parseBlockQuotePrefix,
  fencedCodeLineKindsFromLines,
} from "./structure";
export { parseInlineL2 } from "./inline";
