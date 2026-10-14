/** Conservative UTF-16 budget for retained data URLs, not decoded image pixels. */
export const ASSET_CACHE_BYTES = 32 * 1024 * 1024;
export const ASSET_CACHE_ENTRY_BYTES = 8 * 1024 * 1024;
export const ASSET_CACHE_ENTRIES = 200;

/** An attachment path owns one revision; stale versions never share an entry. */
export class ImageAssetCache {
  private readonly entries = new Map<
    string,
    { revision: string; dataUrl: string; bytes: number }
  >();
  private retainedBytes = 0;

  constructor(
    private readonly maxBytes = ASSET_CACHE_BYTES,
    private readonly maxEntryBytes = ASSET_CACHE_ENTRY_BYTES,
    private readonly maxEntries = ASSET_CACHE_ENTRIES,
  ) {}

  get byteLength(): number {
    return this.retainedBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get(path: string, revision: string): string | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    if (entry.revision !== revision) {
      this.delete(path);
      return undefined;
    }
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.dataUrl;
  }

  set(path: string, revision: string, dataUrl: string): void {
    this.delete(path);
    const bytes = dataUrl.length * 2;
    if (
      bytes > this.maxEntryBytes ||
      bytes > this.maxBytes ||
      this.maxEntries < 1
    )
      return;
    while (
      this.entries.size >= this.maxEntries ||
      this.retainedBytes + bytes > this.maxBytes
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(path, { revision, dataUrl, bytes });
    this.retainedBytes += bytes;
  }

  delete(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    this.retainedBytes -= entry.bytes;
    this.entries.delete(path);
  }
}
