import type { Extension } from "@codemirror/state";
import { livePreviewPlugin } from "./plugin";

/** Enable line-level live preview decorations when `enabled` is true. */
export function livePreviewWhen(enabled: boolean): Extension {
  return enabled ? livePreviewPlugin() : [];
}

export { livePreviewPlugin };
export { setLiveImageAssets } from "./plugin";
export {
  activeLinesFromSelection,
  frontmatterLineNumbers,
  shouldSkipLiveLine,
} from "./active-lines";
export {
  parseAtxHeading,
  parseListPrefix,
  parseBlockQuotePrefix,
} from "./structure";
export { parseInlineL1, parseInlineL2 } from "./inline";
