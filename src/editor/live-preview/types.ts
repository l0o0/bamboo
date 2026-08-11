/** 1-based CodeMirror line info for pure helpers (no CM import). */
export interface LineInfo {
  number: number;
  from: number;
  to: number;
  text: string;
}

export interface DocLines {
  lines: number;
  line(n: number): LineInfo;
  lineAt(pos: number): LineInfo;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface AtxHeadingParse {
  level: HeadingLevel;
  /** Exclusive end offset of `#` + following spaces within the line string. */
  markEnd: number;
  textStart: number;
}

export interface PrefixParse {
  /** Exclusive end of list/quote prefix within the line string. */
  markEnd: number;
}

export type InlineKind = "mark" | "strong" | "em" | "code" | "link";

export interface InlineRange {
  from: number;
  to: number;
  kind: InlineKind;
}
