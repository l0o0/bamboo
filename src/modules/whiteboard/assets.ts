export interface WhiteboardAssetCleanupIO {
  getChildren(path: string): Promise<string[]>;
  stat(path: string): Promise<{ type?: string }>;
  remove(path: string): Promise<void>;
}

export async function cleanupWhiteboardAssets(
  assetsDir: string,
  referenced: ReadonlySet<string>,
  io: WhiteboardAssetCleanupIO,
  onError?: (name: string, error: unknown) => void,
): Promise<void> {
  for (const full of await io.getChildren(assetsDir)) {
    const name = PathUtils.filename(full);
    if (referenced.has(name)) continue;
    try {
      if ((await io.stat(full)).type !== "directory") await io.remove(full);
    } catch (error) {
      onError?.(name, error);
    }
  }
}
