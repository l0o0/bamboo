import type {
  AtxHeadingParse,
  HeadingLevel,
  ListPrefixParse,
  PrefixParse,
} from "./types";

const ATX_RE = /^(#{1,6})(\s+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s+)/;
const QUOTE_RE = /^((?:\s*>\s?)+)/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(?:\s*[^`]*)?$/;

export type FencedCodeLineKind =
  "fence-open" | "content" | "fence-close" | null;

export function fencedCodeLineKindsFromLines(
  lines: readonly string[],
): FencedCodeLineKind[] {
  const kinds: FencedCodeLineKind[] = Array(lines.length).fill(null);
  let open: { index: number; marker: string } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const match = FENCE_RE.exec(lines[index]);
    if (!open) {
      if (match) open = { index, marker: match[1] };
      continue;
    }
    if (
      match &&
      match[1][0] === open.marker[0] &&
      match[1].length >= open.marker.length
    ) {
      kinds[open.index] = "fence-open";
      for (let content = open.index + 1; content < index; content++) {
        kinds[content] = "content";
      }
      kinds[index] = "fence-close";
      open = null;
    }
  }
  return kinds;
}

export function fencedCodeLineKinds(source: string): FencedCodeLineKind[] {
  return fencedCodeLineKindsFromLines(source.split("\n"));
}

export function parseAtxHeading(line: string): AtxHeadingParse | null {
  const m = ATX_RE.exec(line);
  if (!m) return null;
  const level = m[1].length as HeadingLevel;
  const markEnd = m[1].length + m[2].length;
  return { level, markEnd, textStart: markEnd };
}

export function parseListPrefix(line: string): ListPrefixParse | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return {
    indent: m[1],
    marker: m[2],
    ordered: /\d+\./.test(m[2]),
    markEnd: m[0].length,
  };
}

export function parseBlockQuotePrefix(line: string): PrefixParse | null {
  const m = QUOTE_RE.exec(line);
  if (!m) return null;
  return { markEnd: m[1].length };
}
