import type { InlineRange } from "./types";

/**
 * L1/L2 inline ranges for a single line (offsets relative to the line string).
 * `mark` ranges are syntax to hide; content kinds style the inner text.
 */
export function parseInlineL1(line: string): InlineRange[] {
  return parseInline(line, { code: false, link: false });
}

export function parseInlineL2(line: string): InlineRange[] {
  return parseInline(line, { code: true, link: true });
}

function parseInline(
  line: string,
  opts: { code: boolean; link: boolean },
): InlineRange[] {
  const out: InlineRange[] = [];
  let i = 0;
  while (i < line.length) {
    // Inline code first (highest priority for backtick)
    if (opts.code && line[i] === "`") {
      const close = line.indexOf("`", i + 1);
      if (close > i + 1) {
        out.push({ from: i, to: i + 1, kind: "mark" });
        out.push({ from: i + 1, to: close, kind: "code" });
        out.push({ from: close, to: close + 1, kind: "mark" });
        i = close + 1;
        continue;
      }
    }

    // Links [text](url)
    if (opts.link && line[i] === "[") {
      const closeBracket = line.indexOf("]", i + 1);
      if (
        closeBracket > i &&
        line[closeBracket + 1] === "(" &&
        line.indexOf(")", closeBracket + 2) !== -1
      ) {
        const closeParen = line.indexOf(")", closeBracket + 2);
        out.push({ from: i, to: i + 1, kind: "mark" }); // [
        out.push({ from: i + 1, to: closeBracket, kind: "link" });
        out.push({ from: closeBracket, to: closeParen + 1, kind: "mark" }); // ](url)
        i = closeParen + 1;
        continue;
      }
    }

    // Strong **...**
    if (line[i] === "*" && line[i + 1] === "*") {
      const close = line.indexOf("**", i + 2);
      if (close !== -1 && close > i + 2) {
        out.push({ from: i, to: i + 2, kind: "mark" });
        out.push({ from: i + 2, to: close, kind: "strong" });
        out.push({ from: close, to: close + 2, kind: "mark" });
        i = close + 2;
        continue;
      }
    }

    // Emphasis *...* (single asterisk, not part of **)
    if (line[i] === "*" && line[i + 1] !== "*") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "*" && line[j - 1] !== "\\") break;
        j++;
      }
      if (j < line.length && j > i + 1) {
        out.push({ from: i, to: i + 1, kind: "mark" });
        out.push({ from: i + 1, to: j, kind: "em" });
        out.push({ from: j, to: j + 1, kind: "mark" });
        i = j + 1;
        continue;
      }
    }

    i++;
  }
  return out;
}
