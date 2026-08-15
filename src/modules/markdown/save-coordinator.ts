export type SaveRequest = {
  force?: boolean;
  cleanupImages?: boolean;
};

export type SaveSnapshot = {
  rev: number;
  value: string;
};

type NormalizedSaveRequest = {
  force: boolean;
  cleanupImages: boolean;
};

export interface SaveCoordinatorOptions {
  getSnapshot: () => SaveSnapshot | Promise<SaveSnapshot>;
  write: (value: string, request: NormalizedSaveRequest) => Promise<void>;
  onStateChange?: () => void;
}

/**
 * Single-writer save queue keyed by document revision.
 *
 * Autosave, Ctrl+S, and close flush all enqueue a target revision. A write
 * always snapshots the latest editor value; if the user types during I/O the
 * next loop iteration persists that newer revision instead of dropping it.
 */
export class SaveCoordinator {
  currentRev = 0;
  savedRev = 0;
  writing = false;
  lastError: Error | null = null;

  private pending: NormalizedSaveRequest | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: SaveCoordinatorOptions) {}

  get dirty() {
    return this.currentRev !== this.savedRev;
  }

  markChanged() {
    this.currentRev += 1;
    this.lastError = null;
    this.options.onStateChange?.();
  }

  request(request: SaveRequest = {}): Promise<void> {
    this.enqueue(request);
    return this.idle();
  }

  idle(): Promise<void> {
    this.tail = this.tail.then(
      () => this.drain(),
      () => this.drain(),
    );
    return this.tail;
  }

  private enqueue(request: SaveRequest) {
    if (!this.pending) {
      this.pending = {
        force: !!request.force,
        cleanupImages: !!request.cleanupImages,
      };
      return;
    }
    this.pending.force ||= !!request.force;
    this.pending.cleanupImages ||= !!request.cleanupImages;
  }

  private async drain() {
    while (this.pending || this.dirty) {
      const request = this.pending ?? { force: false, cleanupImages: false };
      this.pending = null;
      if (!request.force && !this.dirty) continue;

      const snapshot = await this.options.getSnapshot();
      if (!request.force && snapshot.rev === this.savedRev) continue;

      this.writing = true;
      this.lastError = null;
      this.options.onStateChange?.();
      try {
        await this.options.write(snapshot.value, request);
        this.savedRev = snapshot.rev;
        this.lastError = null;
      } catch (error) {
        this.lastError =
          error instanceof Error ? error : new Error(String(error));
        this.options.onStateChange?.();
        throw this.lastError;
      } finally {
        this.writing = false;
        this.options.onStateChange?.();
      }
    }
  }
}
