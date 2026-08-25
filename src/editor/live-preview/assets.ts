import { EDITOR_MESSAGE_SOURCE } from "../../modules/markdown/editor-protocol";
import { normalizeAssetReference } from "../../modules/markdown/images/model";

const requested = new Set<string>();
const lastAttempt = new Map<string, number>();
/** Cooldown before re-requesting a previously failed asset (ms). */
const RETRY_COOLDOWN_MS = 10_000;
let nextRequestId = 1;

function channel() {
  return new URL(window.location.href).searchParams.get("channel") || "";
}

export function requestLiveAsset(reference: string) {
  const normalized = normalizeAssetReference(reference) || reference;
  if (!normalized) return;
  const now = Date.now();
  if (
    requested.has(normalized) &&
    now - (lastAttempt.get(normalized) ?? 0) < RETRY_COOLDOWN_MS
  ) {
    return;
  }
  requested.add(normalized);
  lastAttempt.set(normalized, now);
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

/**
 * Drop the remembered state for a reference (all references when called
 * without one) so the next widget render can re-request it. Used after a
 * resolution error so "图片缺失或尚未同步" can recover once the file appears.
 */
export function forgetLiveAsset(reference?: string) {
  if (!reference) {
    requested.clear();
    lastAttempt.clear();
    return;
  }
  const normalized = normalizeAssetReference(reference) || reference;
  requested.delete(normalized);
  lastAttempt.delete(normalized);
}
