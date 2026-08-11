import type { AtxHeadingParse, HeadingLevel, PrefixParse } from "./types";

const ATX_RE = /^(#{1,6})(\s+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s+)/;
const QUOTE_RE = /^((?:\s*>\s?)+)/;

export function parseAtxHeading(line: string): AtxHeadingParse | null {
  const m = ATX_RE.exec(line);
  if (!m) return null;
  const level = m[1].length as HeadingLevel;
  const markEnd = m[1].length + m[2].length;
  return { level, markEnd, textStart: markEnd };
}

export function parseListPrefix(line: string): PrefixParse | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return { markEnd: m[0].length };
}

export function parseBlockQuotePrefix(line: string): PrefixParse | null {
  const m = QUOTE_RE.exec(line);
  if (!m) return null;
  return { markEnd: m[1].length };
}
