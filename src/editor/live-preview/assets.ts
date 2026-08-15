import { EDITOR_MESSAGE_SOURCE } from "../../modules/markdown/editor-protocol";
import { normalizeAssetReference } from "../../modules/markdown/images/model";

const requested = new Set<string>();
let nextRequestId = 1;

function channel() {
  return new URL(window.location.href).searchParams.get("channel") || "";
}

export function requestLiveAsset(reference: string) {
  const normalized = normalizeAssetReference(reference) || reference;
  if (!normalized || requested.has(normalized)) return;
  requested.add(normalized);
  window.parent?.postMessage(
    {
      source: EDITOR_MESSAGE_SOURCE,
      channel: channel(),
      v: 1,
      type: "resolveAsset",
      payload: { requestId: nextRequestId++, reference: normalized },
    },
    "*",
  );
}

export function rememberLiveAsset(reference: string) {
  const normalized = normalizeAssetReference(reference) || reference;
  if (normalized) requested.add(normalized);
}

export function forgetLiveAsset(reference?: string) {
  if (!reference) {
    requested.clear();
    return;
  }
  const normalized = normalizeAssetReference(reference) || reference;
  requested.delete(normalized);
}
