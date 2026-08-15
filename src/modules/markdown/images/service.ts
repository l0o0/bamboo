import {
  buildAssetFilename,
  bytesToDataUrl,
  externalImageReferences,
  mimeFromAssetPath,
  normalizeAssetReference,
  planUnusedImageCleanup,
  referencedAssets,
  replaceMarkdownRange,
  validateImageInput,
} from "./model";
import type { ImageAssetMap } from "../editor-protocol";

function assertImageCapableItem(
  item: Zotero.Item,
  requireEditable = false,
): void {
  if (!item.isStoredFileAttachment?.()) {
    throw new Error("仅存储在 Zotero 中的 Markdown 附件支持插入图片");
  }
  if (!item.attachmentContentType?.startsWith("text/")) {
    throw new Error("当前附件不是可同步的文本附件");
  }
  if (requireEditable && !item.isEditable()) {
    throw new Error("当前附件为只读，无法插入图片");
  }
}

function storageRoot(item: Zotero.Item, requireEditable = false): string {
  assertImageCapableItem(item, requireEditable);
  return Zotero.Attachments.getStorageDirectory(item).path;
}

export async function writeImageAsset(
  item: Zotero.Item,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const extension = validateImageInput(mimeType, bytes.byteLength);
  const root = storageRoot(item, true);
  const assetsDirectory = PathUtils.join(root, "assets");
  await IOUtils.makeDirectory(assetsDirectory, { ignoreExisting: true });

  const filename = buildAssetFilename(extension);
  const relativePath = `assets/${filename}`;
  await IOUtils.write(PathUtils.join(assetsDirectory, filename), bytes);
  return relativePath;
}

const assetCache = new Map<string, { key: string; dataUrl: string }>();

export async function resolveImageAsset(
  item: Zotero.Item,
  reference: string,
): Promise<string> {
  const normalized = normalizeAssetReference(reference);
  const mimeType = normalized ? mimeFromAssetPath(normalized) : null;
  if (!normalized || !mimeType) throw new Error("不支持的图片引用");

  const root = storageRoot(item);
  const filename = normalized.slice("assets/".length);
  const path = PathUtils.join(root, "assets", filename);
  if (!(await IOUtils.exists(path))) throw new Error("图片缺失或尚未同步");
  const info = await IOUtils.stat(path);
  const key = `${path}:${info.lastModified}:${info.size}`;
  const cached = assetCache.get(normalized);
  if (cached?.key === key) return cached.dataUrl;
  const dataUrl = bytesToDataUrl(await IOUtils.read(path), mimeType);
  assetCache.set(normalized, { key, dataUrl });
  return dataUrl;
}

export async function resolveImageAssetEntry(
  item: Zotero.Item,
  reference: string,
): Promise<{ dataUrl?: string; error?: string }> {
  try {
    return { dataUrl: await resolveImageAsset(item, reference) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveImageAssets(
  item: Zotero.Item,
  markdown: string,
): Promise<ImageAssetMap> {
  const result: ImageAssetMap = {};
  await Promise.all(
    referencedAssets(markdown).map(async (reference) => {
      try {
        result[reference] = {
          dataUrl: await resolveImageAsset(item, reference),
        };
      } catch (error) {
        result[reference] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return result;
}

export async function cleanupUnusedImageAssets(
  item: Zotero.Item,
  markdown: string,
): Promise<number> {
  const root = storageRoot(item, true);
  const directory = PathUtils.join(root, "assets");
  if (!(await IOUtils.exists(directory))) return 0;
  const children = await IOUtils.getChildren(directory);
  const references = await Promise.all(
    children.map(async (path) => {
      const filename = path.split(/[\\/]/).pop() || "";
      const info = await IOUtils.stat(path);
      return info.type === "regular"
        ? `assets/${filename}`
        : `assets/${filename}/`;
    }),
  );
  const plan = planUnusedImageCleanup(references, markdown);
  const removeSet = new Set(plan.remove);
  for (let index = 0; index < children.length; index++) {
    if (removeSet.has(references[index])) {
      await IOUtils.remove(children[index]);
    }
  }
  if (plan.removeDirectory) {
    await IOUtils.remove(directory);
  }
  return plan.remove.length;
}

export async function importExternalImages(
  item: Zotero.Item,
  markdown: string,
): Promise<{ markdown: string; imported: number }> {
  let next = markdown;
  let imported = 0;
  for (const image of externalImageReferences(markdown).sort(
    (a, b) => b.from - a.from,
  )) {
    try {
      const response = await fetch(image.source);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mimeType = (response.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const reference = await writeImageAsset(item, bytes, mimeType);
      next = replaceMarkdownRange(
        next,
        image.from,
        image.to,
        `![${image.alt}](${reference})`,
      );
      imported++;
    } catch (error) {
      ztoolkit.log("Failed to import external markdown image", error);
    }
  }
  return { markdown: next, imported };
}
