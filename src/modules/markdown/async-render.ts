import {
  PreviewWorkerClientError,
  PreviewWorkerClient,
} from "./preview-worker-client";
import { documentTitleCore, renderMarkdownCore } from "./preview-render-core";

export const MAIN_THREAD_FALLBACK_BYTES = 1 * 1024 * 1024;
export const MAX_WORKER_RENDER_BYTES = 20 * 1024 * 1024;

export type AsyncRenderErrorCode =
  | "DOCUMENT_TOO_LARGE"
  | "WORKER_RENDER_TIMEOUT"
  | "WORKER_RENDER_FAILED"
  | "WORKER_UNAVAILABLE";

export class AsyncRenderError extends Error {
  constructor(
    readonly code: AsyncRenderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AsyncRenderError";
  }
}

export interface RenderedMarkdown {
  title: string;
  bodyHtml: string;
}

export interface AsyncRenderOptions {
  workerRender?: (source: string) => Promise<RenderedMarkdown>;
  syncRender?: (source: string) => RenderedMarkdown;
}

let sharedWorker: PreviewWorkerClient | null = null;

function defaultWorker(): PreviewWorkerClient {
  return (sharedWorker ??= new PreviewWorkerClient());
}

export function disposeMarkdownRenderer(): void {
  sharedWorker?.dispose();
  sharedWorker = null;
}

export function utf8ByteLength(source: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(source).byteLength;
  }
  return unescape(encodeURIComponent(source)).length;
}

function syncResult(source: string): RenderedMarkdown {
  return {
    title: documentTitleCore(source),
    bodyHtml: renderMarkdownCore(source),
  };
}

function renderError(error: unknown): AsyncRenderError {
  if (error instanceof AsyncRenderError) return error;
  if (error instanceof PreviewWorkerClientError) {
    if (error.code === "WORKER_DISPOSED") {
      return new AsyncRenderError("WORKER_RENDER_FAILED", error.message, {
        cause: error,
      });
    }
    return new AsyncRenderError(error.code, error.message, { cause: error });
  }
  return new AsyncRenderError(
    "WORKER_RENDER_FAILED",
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

export async function renderMarkdownAsync(
  { source, title }: { source: string; title?: string },
  options: AsyncRenderOptions & {
    worker?: PreviewWorkerClient;
  } = {},
): Promise<RenderedMarkdown> {
  const size = utf8ByteLength(source);
  if (size > MAX_WORKER_RENDER_BYTES) {
    throw new AsyncRenderError(
      "DOCUMENT_TOO_LARGE",
      "Markdown document exceeds the maximum render size",
    );
  }

  const workerRender =
    options.workerRender ??
    (options.worker
      ? (value: string) => options.worker!.render(value, title)
      : (value: string) => defaultWorker().render(value, title));
  try {
    if (!workerRender)
      throw new PreviewWorkerClientError(
        "WORKER_UNAVAILABLE",
        "Preview Worker is unavailable",
      );
    const rendered = await workerRender(source);
    return title ? { ...rendered, title } : rendered;
  } catch (error) {
    const mapped = renderError(error);
    if (size < MAIN_THREAD_FALLBACK_BYTES) {
      return (options.syncRender ?? syncResult)(source);
    }
    throw mapped;
  }
}
