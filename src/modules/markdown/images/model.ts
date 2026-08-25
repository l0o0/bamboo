import { getString } from "../../../utils/locale";
import { config } from "../../../../package.json";

function imageErrorMessage(
  key: Parameters<typeof getString>[0],
  fallback: string,
) {
  const message = getString(key);
  return message === `${config.addonRef}-${key}` ? fallback : message;
}

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

const EXTENSION_MIMES: Record<string, keyof typeof MIME_EXTENSIONS> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type SupportedImageMime = keyof typeof MIME_EXTENSIONS;

export interface MarkdownImageReference {
  alt: string;
  source: string;
  from: number;
  to: number;
}

export function validateImageInput(mimeType: string, size: number): string {
  const extension = MIME_EXTENSIONS[mimeType as SupportedImageMime];
  if (!extension) {
    throw new Error(
      imageErrorMessage(
        "error-image-format",
        "仅支持 PNG、JPEG、GIF 和 WebP 图片",
      ),
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(imageErrorMessage("error-image-empty", "图片内容为空"));
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      imageErrorMessage("error-image-too-large", "图片不能超过 15 MB"),
    );
  }
  return extension;
}

export function buildAssetFilename(
  extension: string,
  now = Date.now(),
  random = Math.random(),
): string {
  const token = Math.floor(random * 0x100000000)
    .toString(36)
    .padStart(7, "0")
    .slice(-7);
  return `${Math.max(0, Math.floor(now))}-${token}.${extension}`;
}

export function normalizeAssetReference(source: string): string | null {
  let value = source.trim();
  if (value.startsWith("zotero-md://asset/")) {
    value = `assets/${value.slice("zotero-md://asset/".length)}`;
  }
  value = value.replace(/\\/g, "/");
  // Tolerate a leading `./` (Obsidian-style relative paths). `../` and other
  // traversal prefixes are deliberately rejected below by the `assets/` check.
  if (value.startsWith("./")) value = value.slice(2);
  if (!value.startsWith("assets/")) return null;
  const name = value.slice("assets/".length);
  if (!name || name.includes("/") || name === "." || name === "..") {
    return null;
  }
  if (name.includes("\0") || /[?#]/.test(name)) return null;
  return `assets/${name}`;
}

export function mimeFromAssetPath(path: string): SupportedImageMime | null {
  const normalized = normalizeAssetReference(path);
  if (!normalized) return null;
  const extension = normalized.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_MIMES[extension] || null;
}

export function parseMarkdownImages(source: string): MarkdownImageReference[] {
  const images: MarkdownImageReference[] = [];
  // CommonMark image references. The angle-bracket form `![alt](<dest>)`
  // allows spaces in the destination and must be tried first so the plain
  // form does not swallow the `<...>` as part of the source.
  const pattern =
    /!\[([^\]\n]*)\]\(\s*<([^>\n]*)>\s*(?:\s+["'][^"']*["'])?\s*\)|!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const alt = match[1] ?? match[3];
    const src = match[2] ?? match[4];
    if (src === undefined) continue;
    images.push({
      alt: alt ?? "",
      source: src,
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return images;
}

export function referencedAssets(source: string): string[] {
  const refs = parseMarkdownImages(source).map((image) =>
    normalizeAssetReference(image.source),
  );
  // Obsidian-style wikilinks `![[name.ext]]` refer to a sibling of the note
  // (here: the attachment's `assets/` folder). Counting them as references
  // keeps cleanup from deleting files that wikilink syntax points at.
  const wikilink = /!\[\[([^\]\n]+)\]\]/g;
  for (const match of source.matchAll(wikilink)) {
    refs.push(normalizeAssetReference(`assets/${match[1].trim()}`));
  }
  return [...new Set(refs.filter((path): path is string => path !== null))];
}

/**
 * Filename pattern of plugin-generated image assets (`buildAssetFilename`):
 * `<millisecond timestamp>-<7-char base36 token>.<ext>`.
 *
 * Cleanup may only ever delete files matching this pattern. User-managed
 * files (custom names, Obsidian-style spaces, wikilink targets, or references
 * the parser cannot see) must never be removed, even when they look
 * unreferenced.
 */
export const GENERATED_ASSET_RE = /^\d{10,}-\w{7}\.(png|jpe?g|gif|webp)$/i;

export function isGeneratedAsset(path: string): boolean {
  // `cleanupUnusedImageAssets` passes `assets/<name>` entries; strip the
  // prefix (and tolerate a bare name) before matching the basename.
  const name = path.replace(/^assets\//, "");
  return GENERATED_ASSET_RE.test(name);
}

export function planUnusedImageCleanup(
  children: string[],
  markdown: string,
): { remove: string[]; removeDirectory: boolean } {
  const referenced = new Set(referencedAssets(markdown));
  const remove = children.filter(
    (path) =>
      isGeneratedAsset(path) &&
      mimeFromAssetPath(path) &&
      !referenced.has(path),
  );
  return {
    remove,
    removeDirectory: remove.length === children.length,
  };
}

export function externalImageReferences(
  source: string,
): MarkdownImageReference[] {
  return parseMarkdownImages(source).filter(({ source: imageSource }) =>
    /^https?:\/\/[^\s)]+$/i.test(imageSource),
  );
}

export function replaceMarkdownRange(
  source: string,
  from: number,
  to: number,
  insert: string,
) {
  return source.slice(0, from) + insert + source.slice(to);
}

export function bytesToDataUrl(
  bytes: Uint8Array,
  mimeType: SupportedImageMime,
): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    encoded += alphabet[a >> 2];
    encoded += alphabet[((a & 3) << 4) | (b >> 4)];
    encoded += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    encoded += hasC ? alphabet[c & 63] : "=";
  }
  return `data:${mimeType};base64,${encoded}`;
}
