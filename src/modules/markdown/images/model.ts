import { getString } from "../../../utils/locale";
import { config } from "../../../../package.json";
import { parser as markdownParser } from "@lezer/markdown";
import MarkdownIt from "markdown-it";
import { stripFrontmatter } from "../frontmatter";

let unescapeMarkdownDestination: ((value: string) => string) | undefined;

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

export {
  MAX_DISPLAY_IMAGE_WIDTH,
  decodeImageAttribute,
  parseHtmlImage,
  serializeImageReference,
} from "./html";
export type { MarkdownImageReference } from "./html";
import { parseHtmlImage } from "./html";
import type { MarkdownImageReference } from "./html";
import { normalizeAssetReference, parseWikiImage } from "./reference";
export { normalizeAssetReference, parseWikiImage } from "./reference";

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

/** Try the literal filename before interpreting one layer of URI encoding. */
export function assetReferenceCandidates(source: string): string[] {
  const candidates: string[] = [];
  const literal = normalizeAssetReference(source);
  if (literal) candidates.push(literal);
  try {
    const decoded = normalizeAssetReference(decodeURIComponent(source));
    if (decoded && !candidates.includes(decoded)) candidates.push(decoded);
  } catch {
    // A literal percent sign is a valid filename, even when it is not a URI.
  }
  return candidates;
}

export function imageAssetFromMap<
  T extends { dataUrl?: string; error?: string },
>(source: string, assets: Readonly<Record<string, T>>): T | undefined {
  const candidates = assetReferenceCandidates(source);
  return (
    candidates
      .map((reference) => assets[reference])
      .find((asset) => asset?.dataUrl) ??
    candidates.map((reference) => assets[reference]).find(Boolean)
  );
}

function unescapeDestination(value: string): string {
  return (unescapeMarkdownDestination ??= new MarkdownIt().utils.unescapeAll)(
    value,
  );
}

/** Resolve cross-line CommonMark definitions without changing their source. */
export function parseReferenceImageDocument(document: string): {
  images: MarkdownImageReference[];
  definitions: Array<{ from: number; to: number }>;
} {
  const { body: source } = stripFrontmatter(document);
  const offset = document.length - source.length;
  if (!source.includes("]:")) return { images: [], definitions: [] };
  const definitionRanges: Array<{ from: number; to: number }> = [];
  const definitions = new Map<string, { source: string; title?: string }>();
  const labelKey = (label: string) =>
    label.trim().replace(/\s+/g, " ").toUpperCase();
  const tree = markdownParser.parse(source);
  tree.iterate({
    enter({ node }) {
      if (node.name !== "LinkReference") return;
      definitionRanges.push({ from: node.from + offset, to: node.to + offset });
      const label = node.getChild("LinkLabel");
      const url = node.getChild("URL");
      if (!label || !url) return;
      const key = labelKey(source.slice(label.from + 1, label.to - 1));
      // CommonMark uses the first definition when a label is repeated.
      if (definitions.has(key)) return;
      const raw = source.slice(url.from, url.to);
      const title = node.getChild("LinkTitle");
      definitions.set(key, {
        source: unescapeDestination(
          raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw,
        ),
        ...(title
          ? {
              title: unescapeDestination(
                source.slice(title.from + 1, title.to - 1),
              ),
            }
          : {}),
      });
    },
  });
  const images: MarkdownImageReference[] = [];
  tree.iterate({
    enter({ node }) {
      if (node.name !== "Image" || node.getChild("URL")) return;
      const marks = node.getChildren("LinkMark");
      if (marks.length < 2) return;
      const alt = source.slice(marks[0].to, marks[1].from);
      const label = node.getChild("LinkLabel");
      const rawLabel = label ? source.slice(label.from + 1, label.to - 1) : "";
      const definition = definitions.get(labelKey(rawLabel || alt));
      if (!definition) return;
      images.push({
        from: node.from + offset,
        to: node.to + offset,
        alt: unescapeDestination(alt),
        ...definition,
      });
    },
  });
  return { images, definitions: definitionRanges };
}

export function parseReferenceMarkdownImages(
  document: string,
): MarkdownImageReference[] {
  return parseReferenceImageDocument(document).images;
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
    /!\[([^\]\n]*)\]\(\s*<([^>\n]*)>\s*(?:\s+["']([^"']*)["'])?\s*\)|!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const alt = match[1] ?? match[4];
    const src = match[2] ?? match[5];
    const title = match[3] ?? match[6];
    if (src === undefined) continue;
    images.push({
      alt: alt ?? "",
      source: unescapeDestination(src),
      from: match.index,
      to: match.index + match[0].length,
      ...(title !== undefined ? { title } : {}),
    });
  }
  for (const match of source.matchAll(
    /<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi,
  )) {
    const image = parseHtmlImage(source, match.index);
    if (!image) continue;
    // A Markdown image alt/title may itself contain literal HTML.
    if (
      images.some((other) => other.from <= image.from && other.to >= image.to)
    )
      continue;
    for (let index = images.length - 1; index >= 0; index--) {
      if (images[index].from >= image.from && images[index].to <= image.to)
        images.splice(index, 1);
    }
    images.push(image);
  }
  for (const match of source.matchAll(/!\[\[[^\]\n]+\]\]/g)) {
    if (
      images.some(
        (image) => image.from <= match.index && image.to > match.index,
      )
    )
      continue;
    const image = parseWikiImage(source, match.index);
    if (image) images.push(image);
  }
  for (const image of parseReferenceMarkdownImages(source)) {
    if (
      !images.some((other) => other.from <= image.from && other.to >= image.to)
    )
      images.push(image);
  }
  return images.sort((a, b) => a.from - b.from);
}

export function referencedAssets(source: string): string[] {
  const refs: Array<string | null> = parseMarkdownImages(source).flatMap(
    (image) => assetReferenceCandidates(image.source),
  );
  // Obsidian-style wikilinks `![[name.ext]]` refer to a sibling of the note
  // (here: the attachment's `assets/` folder). Counting them as references
  // keeps cleanup from deleting files that wikilink syntax points at.
  const wikilink = /!\[\[([^\]\n]+)\]\]/g;
  for (const match of source.matchAll(wikilink)) {
    refs.push(normalizeAssetReference(`assets/${match[1].trim()}`));
  }
  // Retain every local reference definition, even if its label is currently
  // unused. Cleanup must not remove a reference-style image's destination.
  // The existing CommonMark parser handles labels, titles and multiline URLs
  // without treating fenced examples or remote URLs as local references.
  if (source.includes("]:")) {
    // Keep this lazy: the same module also supplies lightweight editor helpers.
    markdownParser.parse(source).iterate({
      enter({ node }) {
        if (node.name !== "LinkReference") return;
        const url = node.getChild("URL");
        if (!url) return;
        const raw = source.slice(url.from, url.to);
        const literal =
          raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
        const destination = unescapeDestination(literal);
        refs.push(...assetReferenceCandidates(literal));
        refs.push(...assetReferenceCandidates(destination));
        // URL-encoded local filenames can point at the same physical asset.
        // Keep the literal spelling too; cleanup deliberately favors keeping
        // an extra file over deleting a possibly referenced image.
        try {
          refs.push(normalizeAssetReference(decodeURIComponent(destination)));
        } catch {
          // A malformed escape does not invalidate the literal reference.
        }
      },
    });
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
