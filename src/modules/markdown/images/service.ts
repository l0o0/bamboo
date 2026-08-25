import {
  MAX_IMAGE_BYTES,
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
import { getString } from "../../../utils/locale";

function assertImageCapableItem(
  item: Zotero.Item,
  requireEditable = false,
): void {
  if (!item.isStoredFileAttachment?.()) {
    throw new Error(getString("error-stored-image-only"));
  }
  if (!item.attachmentContentType?.startsWith("text/")) {
    throw new Error(getString("error-not-text-attachment"));
  }
  if (requireEditable && !item.isEditable()) {
    throw new Error(getString("error-read-only-image"));
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

/** Bounded LRU cache of resolved asset data URLs (keyed by normalized ref). */
const ASSET_CACHE_LIMIT = 200;
const assetCache = new Map<string, { key: string; dataUrl: string }>();

export async function resolveImageAsset(
  item: Zotero.Item,
  reference: string,
): Promise<string> {
  const normalized = normalizeAssetReference(reference);
  const mimeType = normalized ? mimeFromAssetPath(normalized) : null;
  if (!normalized || !mimeType) {
    throw new Error(getString("error-image-reference-unsupported"));
  }

  const root = storageRoot(item);
  const filename = normalized.slice("assets/".length);
  const path = PathUtils.join(root, "assets", filename);
  if (!(await IOUtils.exists(path))) {
    throw new Error(getString("error-image-missing"));
  }
  const info = await IOUtils.stat(path);
  const key = `${path}:${info.lastModified}:${info.size}`;
  const cached = assetCache.get(normalized);
  if (cached?.key === key) {
    // LRU recency refresh.
    assetCache.delete(normalized);
    assetCache.set(normalized, cached);
    return cached.dataUrl;
  }
  const dataUrl = bytesToDataUrl(await IOUtils.read(path), mimeType);
  if (assetCache.size >= ASSET_CACHE_LIMIT) {
    const oldest = assetCache.keys().next().value;
    if (oldest !== undefined) assetCache.delete(oldest);
  }
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

/** Download timeout for external images (ms). */
const EXTERNAL_IMAGE_TIMEOUT_MS = 15_000;

/** Read a response body without ever buffering more than the image cap. */
export async function readResponseBytes(
  response: Response,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error("Image response exceeds the maximum allowed size");
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Image response exceeds the maximum allowed size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * SSRF guard for `importExternalImages`: only http(s) URLs, and never
 * loopback / link-local / private / reserved hosts. The sandbox `fetch` runs
 * with chrome privileges (no CORS), so a crafted markdown file must not be
 * able to probe local or internal services.
 */
export function isSafeExternalImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // WHATWG URL keeps the brackets around IPv6 hostnames.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a === 169 ||
      a === 255 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return false;
    }
  }
  return true;
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
      if (!isSafeExternalImageUrl(image.source)) {
        ztoolkit.log("Skipped external markdown image (URL blocked)", {
          source: image.source,
        });
        continue;
      }
      // Timeout + size pre-check: a malicious or broken endpoint must not be
      // able to stall the save or pull an unbounded payload into memory
      // (writeImageAsset validates the size only after the full download).
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        EXTERNAL_IMAGE_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetch(image.source, { signal: controller.signal });
        if (!response.ok) continue;
        const declared = Number(response.headers.get("content-length") || 0);
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) continue;
        const bytes = await readResponseBytes(response);
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
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      ztoolkit.log("Failed to import external markdown image", error);
    }
  }
  return { markdown: next, imported };
}
