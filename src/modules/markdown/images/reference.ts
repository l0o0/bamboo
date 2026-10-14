import { MAX_DISPLAY_IMAGE_WIDTH, type MarkdownImageReference } from "./html";

export function normalizeAssetReference(source: string): string | null {
  let value = source.trim();
  if (value.startsWith("zotero-md://asset/")) {
    value = `assets/${value.slice("zotero-md://asset/".length)}`;
  }
  value = value.replace(/\\/g, "/");
  // Only one file within assets/ may be read. Decoding callers must run this
  // guard again so an encoded slash or parent path cannot escape the folder.
  if (value.startsWith("./")) value = value.slice(2);
  if (!value.startsWith("assets/")) return null;
  const name = value.slice("assets/".length);
  if (!name || name.includes("/") || name === "." || name === "..") return null;
  if (name.includes("\0") || /[?#]/.test(name)) return null;
  return `assets/${name}`;
}

/** Wiki images are attachment-local assets, never arbitrary file paths. */
export function parseWikiImage(
  source: string,
  from = 0,
): MarkdownImageReference | null {
  const match = /^!\[\[([^\]\n]+)\]\]/.exec(source.slice(from));
  if (!match) return null;
  const [target, alias, ...extra] = match[1].split("|");
  if (extra.length || !target.trim()) return null;
  const path = target.trim();
  const reference = normalizeAssetReference(
    path.startsWith("assets/") || path.startsWith("./assets/")
      ? path
      : `assets/${path}`,
  );
  if (!reference) return null;
  const width = alias?.trim();
  const numericWidth = width && /^\d+$/.test(width) ? Number(width) : undefined;
  if (
    numericWidth !== undefined &&
    (numericWidth < 1 || numericWidth > MAX_DISPLAY_IMAGE_WIDTH)
  ) {
    return null;
  }
  return {
    from,
    to: from + match[0].length,
    source: reference,
    alt: numericWidth === undefined && alias ? alias.trim() : path,
    ...(numericWidth !== undefined ? { width: numericWidth } : {}),
  };
}
