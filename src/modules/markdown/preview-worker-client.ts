import {
  isPreviewWorkerResponse,
  type PreviewWorkerRequest,
  type PreviewWorkerResponse,
} from "./preview-worker-protocol";

export type PreviewWorkerErrorCode =
  | "WORKER_UNAVAILABLE"
  | "WORKER_RENDER_TIMEOUT"
  | "WORKER_RENDER_FAILED"
  | "WORKER_DISPOSED";

export class PreviewWorkerClientError extends Error {
  constructor(
    readonly code: PreviewWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PreviewWorkerClientError";
  }
}

export interface WorkerLike {
  postMessage(message: PreviewWorkerRequest): void;
  terminate(): void;
  addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; error?: unknown }) => void,
  ): void;
  removeEventListener?(
    type: "message" | "error",
    listener: (event: { data?: unknown; error?: unknown }) => void,
  ): void;
}

interface PendingRequest {
  resolve: (response: Extract<PreviewWorkerResponse, { ok: true }>) => void;
  reject: (error: PreviewWorkerClientError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PreviewWorkerClientOptions {
  timeoutMs?: number;
}

export type WorkerFactory = () => WorkerLike | null;

function productionWorkerFactory(): WorkerLike | null {
  try {
    const Constructor = (
      globalThis as typeof globalThis & {
        ChromeWorker?: new (url: string) => WorkerLike;
      }
    ).ChromeWorker;
    if (!Constructor) return null;
    const url = `chrome://${addon.data.config.addonRef}/content/workers/preview-worker.js`;
    return new Constructor(url);
  } catch (error) {
    ztoolkit.log("Failed to create preview Worker", error);
    return null;
  }
}

export class PreviewWorkerClient {
  private worker: WorkerLike | null = null;
  private nextRequestID = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;
  private readonly timeoutMs: number;

  constructor(
    private readonly factory: WorkerFactory = productionWorkerFactory,
    options: PreviewWorkerClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  render(
    source: string,
    title?: string,
  ): Promise<Extract<PreviewWorkerResponse, { ok: true }>> {
    if (this.disposed) {
      return Promise.reject(
        new PreviewWorkerClientError(
          "WORKER_DISPOSED",
          "Preview renderer has been disposed",
        ),
      );
    }
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(
        new PreviewWorkerClientError(
          "WORKER_UNAVAILABLE",
          "Preview Worker is unavailable",
        ),
      );
    }

    const requestID = this.nextRequestID++;
    const request: PreviewWorkerRequest = {
      version: 1,
      requestID,
      source,
      ...(title ? { title } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(requestID);
        if (!entry) return;
        this.pending.delete(requestID);
        entry.reject(
          new PreviewWorkerClientError(
            "WORKER_RENDER_TIMEOUT",
            "Preview Worker timed out",
          ),
        );
        this.resetWorker();
      }, this.timeoutMs);
      this.pending.set(requestID, { resolve, reject, timer });
      try {
        worker.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestID);
        reject(
          new PreviewWorkerClientError(
            "WORKER_RENDER_FAILED",
            error instanceof Error ? error.message : String(error),
          ),
        );
        this.resetWorker();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new PreviewWorkerClientError(
      "WORKER_DISPOSED",
      "Preview renderer has been disposed",
    );
    for (const [requestID, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestID);
    }
    this.resetWorker();
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker;
    const worker = this.factory();
    if (!worker) return null;
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleError);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: { data?: unknown }): void => {
    if (!isPreviewWorkerResponse(event.data)) return;
    const response = event.data;
    const pending = this.pending.get(response.requestID);
    if (!pending) return;
    this.pending.delete(response.requestID);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response);
    } else {
      pending.reject(
        new PreviewWorkerClientError("WORKER_RENDER_FAILED", response.error),
      );
    }
  };

  private readonly handleError = (event: { error?: unknown }): void => {
    const message =
      event.error instanceof Error
        ? event.error.message
        : "Preview Worker failed";
    const error = new PreviewWorkerClientError("WORKER_RENDER_FAILED", message);
    for (const [requestID, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestID);
    }
    this.resetWorker();
  };

  private resetWorker(): void {
    const worker = this.worker;
    if (!worker) return;
    worker.removeEventListener?.("message", this.handleMessage);
    worker.removeEventListener?.("error", this.handleError);
    worker.terminate();
    this.worker = null;
  }
}
