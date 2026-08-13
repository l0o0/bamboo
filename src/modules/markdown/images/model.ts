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
    throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片");
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("图片内容为空");
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new Error("图片不能超过 15 MB");
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
  const pattern = /!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    images.push({
      alt: match[1],
      source: match[2],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return images;
}

export function referencedAssets(source: string): string[] {
  return [
    ...new Set(
      parseMarkdownImages(source)
        .map((image) => normalizeAssetReference(image.source))
        .filter((path): path is string => !!path),
    ),
  ];
}

export function planUnusedImageCleanup(
  children: string[],
  markdown: string,
): { remove: string[]; removeDirectory: boolean } {
  const referenced = new Set(referencedAssets(markdown));
  const remove = children.filter(
    (path) => mimeFromAssetPath(path) && !referenced.has(path),
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
