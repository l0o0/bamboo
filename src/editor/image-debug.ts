/// <reference lib="dom" />

import { EDITOR_MESSAGE_SOURCE } from "../modules/markdown/editor-protocol";

const channel = new URL(window.location.href).searchParams.get("channel") || "";

/** Forward iframe image diagnostics to both DevTools and Zotero Debug Output. */
export function imageDebug(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.info("[Zotero Markdown][ImageDebug]", event, details);
  window.parent?.postMessage(
    {
      source: EDITOR_MESSAGE_SOURCE,
      channel,
      type: "imageDebug",
      payload: { event, details },
    },
    "*",
  );
}
