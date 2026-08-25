export const PREVIEW_WORKER_PROTOCOL_VERSION = 1 as const;

export interface PreviewWorkerRequest {
  version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
  requestID: number;
  source: string;
  title?: string;
}

export type PreviewWorkerResponse =
  | {
      version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
      requestID: number;
      ok: true;
      title: string;
      bodyHtml: string;
    }
  | {
      version: typeof PREVIEW_WORKER_PROTOCOL_VERSION;
      requestID: number;
      ok: false;
      error: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function isPreviewWorkerRequest(
  value: unknown,
): value is PreviewWorkerRequest {
  const data = record(value);
  return (
    data?.version === PREVIEW_WORKER_PROTOCOL_VERSION &&
    typeof data.requestID === "number" &&
    Number.isInteger(data.requestID) &&
    data.requestID >= 0 &&
    typeof data.source === "string" &&
    (data.title === undefined || typeof data.title === "string")
  );
}

export function isPreviewWorkerResponse(
  value: unknown,
): value is PreviewWorkerResponse {
  const data = record(value);
  if (
    data?.version !== PREVIEW_WORKER_PROTOCOL_VERSION ||
    typeof data.requestID !== "number" ||
    !Number.isInteger(data.requestID) ||
    data.requestID < 0 ||
    typeof data.ok !== "boolean"
  ) {
    return false;
  }
  if (data.ok) {
    return typeof data.title === "string" && typeof data.bodyHtml === "string";
  }
  return typeof data.error === "string";
}
