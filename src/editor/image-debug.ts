/// <reference lib="dom" />

import { EDITOR_MESSAGE_SOURCE } from "../modules/markdown/editor-protocol";

const channel = new URL(window.location.href).searchParams.get("channel") || "";

function imageDebugEnabled() {
  try {
    return new URL(window.location.href).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}

/** Forward iframe image diagnostics when `?debug=1` is on the editor URL. */
export function imageDebug(
  event: string,
  details: Record<string, unknown> = {},
) {
  if (!imageDebugEnabled()) return;
  console.info("[Bamboo][ImageDebug]", event, details);
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
