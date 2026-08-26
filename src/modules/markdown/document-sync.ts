export interface DocumentSyncSource {
  sourceID: string;
  itemID: number;
  hasLocalWork(): boolean;
  flush(): Promise<void>;
  getCurrentValue(): string;
  readPersisted(): Promise<string>;
  applyPersisted(value: string): void | Promise<void>;
}

export type DocumentRefreshResult =
  "refreshed" | "unchanged" | "skipped-dirty" | "blocked-peer-dirty";

interface SourceState {
  source: DocumentSyncSource;
  editSequence: number;
  seenRevision: number;
}

interface DocumentState {
  revision: number;
}

/**
 * Coordinates open views of one attachment without retaining document text.
 * Views exchange content only when a clean view explicitly refreshes.
 */
export class DocumentSyncRegistry {
  private readonly sources = new Map<string, SourceState>();
  private readonly documents = new Map<number, DocumentState>();
  private readonly refreshing = new Map<
    string,
    Promise<DocumentRefreshResult>
  >();
  private editSequence = 0;

  register(source: DocumentSyncSource): () => void {
    this.release(source.sourceID);
    const document = this.document(source.itemID);
    const state: SourceState = {
      source,
      editSequence: 0,
      seenRevision: document.revision,
    };
    this.sources.set(source.sourceID, state);

    return () => {
      if (this.sources.get(source.sourceID) === state) {
        this.release(source.sourceID);
      }
    };
  }

  has(sourceID: string): boolean {
    return this.sources.has(sourceID);
  }

  markEdited(sourceID: string): void {
    const state = this.sources.get(sourceID);
    if (!state) return;
    state.editSequence = ++this.editSequence;
  }

  markSaved(sourceID: string): void {
    const state = this.sources.get(sourceID);
    if (!state) return;
    const document = this.document(state.source.itemID);
    document.revision += 1;
    state.seenRevision = document.revision;
  }

  refreshOnFocus(sourceID: string): Promise<DocumentRefreshResult> {
    const pending = this.refreshing.get(sourceID);
    if (pending) return pending;

    const refresh = this.refresh(sourceID).finally(() => {
      if (this.refreshing.get(sourceID) === refresh) {
        this.refreshing.delete(sourceID);
      }
    });
    this.refreshing.set(sourceID, refresh);
    return refresh;
  }

  private async refresh(sourceID: string): Promise<DocumentRefreshResult> {
    const target = this.sources.get(sourceID);
    if (!target) return "unchanged";
    if (target.source.hasLocalWork()) return "skipped-dirty";

    const dirtyPeers = [...this.sources.values()]
      .filter(
        (candidate) =>
          candidate !== target &&
          candidate.source.itemID === target.source.itemID &&
          candidate.source.hasLocalWork(),
      )
      .sort((a, b) => b.editSequence - a.editSequence);

    if (dirtyPeers.length) {
      const newest = dirtyPeers[0];
      await newest.source.flush();
      if (this.sources.get(sourceID) !== target) return "unchanged";
      if (target.source.hasLocalWork()) return "skipped-dirty";
      if (
        [...this.sources.values()].some(
          (candidate) =>
            candidate !== target &&
            candidate.source.itemID === target.source.itemID &&
            candidate.source.hasLocalWork(),
        )
      ) {
        return "blocked-peer-dirty";
      }
    }

    const document = this.document(target.source.itemID);
    if (!dirtyPeers.length && target.seenRevision >= document.revision) {
      return "unchanged";
    }

    const readRevision = document.revision;
    const persisted = await target.source.readPersisted();
    if (this.sources.get(sourceID) !== target) return "unchanged";
    if (target.source.hasLocalWork()) return "skipped-dirty";

    target.seenRevision = readRevision;
    if (target.source.getCurrentValue() === persisted) return "unchanged";

    await target.source.applyPersisted(persisted);
    return "refreshed";
  }

  private document(itemID: number): DocumentState {
    let document = this.documents.get(itemID);
    if (!document) {
      document = { revision: 0 };
      this.documents.set(itemID, document);
    }
    return document;
  }

  private release(sourceID: string): void {
    const state = this.sources.get(sourceID);
    if (!state) return;
    this.sources.delete(sourceID);
    if (
      ![...this.sources.values()].some(
        (candidate) => candidate.source.itemID === state.source.itemID,
      )
    ) {
      this.documents.delete(state.source.itemID);
    }
  }
}

export const documentSyncRegistry = new DocumentSyncRegistry();
