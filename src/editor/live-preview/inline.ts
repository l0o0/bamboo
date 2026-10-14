import type { InlineRange } from "./types";
import { parseNoteLink } from "../../modules/markdown/note-links";
import { parseMathRanges } from "./math-syntax";

/**
 * L2 inline ranges for a single line (offsets relative to the line string).
 * `mark` ranges are syntax to hide; content kinds style the inner text.
 */
export function parseInlineL2(line: string): InlineRange[] {
  return parseInline(line, { code: true, link: true });
}

function parseInline(
  line: string,
  opts: { code: boolean; link: boolean },
): InlineRange[] {
  const out: InlineRange[] = [];
  const formulas = parseMathRanges(line);
  let formulaIndex = 0;
  let i = 0;
  while (i < line.length) {
    while (formulas[formulaIndex]?.to <= i) formulaIndex++;
    const formula = formulas[formulaIndex];
    if (formula && i >= formula.from) {
      i = formula.to;
      formulaIndex++;
      continue;
    }
    // Skip long uniform delimiter runs in O(1): a pasted line of thousands
    // of `*`/`~`/`` ` `` must not trigger a full-line indexOf scan per
    // character (O(n²)). Runs of 4+ are degenerate markdown anyway.
    const ch = line[i];
    if (
      (ch === "*" || ch === "~" || ch === "`") &&
      line[i + 1] === ch &&
      line[i + 2] === ch &&
      line[i + 3] === ch
    ) {
      let run = 4;
      while (line[i + run] === ch) run++;
      i += run;
      continue;
    }

    // Inline code first (highest priority for backtick), supporting runs of
    // backticks (`` `code` `` / `` ``code`` ``).
    if (opts.code && line[i] === "`") {
      let run = 0;
      while (line[i + run] === "`") run++;
      const close = line.indexOf("`".repeat(run), i + run);
      if (close > i + run) {
        out.push({ from: i, to: i + run, kind: "mark" });
        out.push({ from: i + run, to: close, kind: "code" });
        out.push({ from: close, to: close + run, kind: "mark" });
        i = close + run;
        continue;
      }
    }

    // Wiki links [[name]] / [[name|label]]. Image wikilinks are handled by
    // the image parser and must never become document navigation links.
    if (
      opts.link &&
      line[i] === "[" &&
      line[i + 1] === "[" &&
      findUnescaped(line, "[", i) === i &&
      (i === 0 || line[i - 1] !== "!")
    ) {
      const close = line.indexOf("]]", i + 2);
      if (close > i + 2) {
        const raw = line.slice(i + 2, close);
        const separator = raw.indexOf("|");
        const labelStart = separator < 0 ? i + 2 : i + 2 + separator + 1;
        const label = separator < 0 ? raw : raw.slice(separator + 1);
        if (
          parseNoteLink(line.slice(i, close + 2)) &&
          raw.trim() &&
          label.trim()
        ) {
          const linkSource = { from: i, to: close + 2 };
          out.push({ from: i, to: i + 2, kind: "mark", linkSource });
          if (labelStart > i + 2) {
            out.push({ from: i + 2, to: labelStart, kind: "mark", linkSource });
          }
          out.push({
            from: labelStart,
            to: close,
            kind: "link",
            linkSource,
            href: line.slice(i, close + 2),
          });
          out.push({ from: close, to: close + 2, kind: "mark", linkSource });
          i = close + 2;
          continue;
        }
      }
    }

    // Links [text](url)
    if (opts.link && line[i] === "[") {
      const closeBracket = findUnescaped(line, "]", i + 1);
      if (
        closeBracket > i &&
        (i === 0 || line[i - 1] !== "!") &&
        line[closeBracket + 1] === "(" &&
        findUnescaped(line, ")", closeBracket + 2) !== -1
      ) {
        const closeParen = findUnescaped(line, ")", closeBracket + 2);
        const linkSource = { from: i, to: closeParen + 1 };
        out.push({ from: i, to: i + 1, kind: "mark", linkSource }); // [
        out.push({
          from: i + 1,
          to: closeBracket,
          kind: "link",
          linkSource,
          href: line.slice(closeBracket + 2, closeParen),
        });
        out.push({
          from: closeBracket,
          to: closeParen + 1,
          kind: "mark",
          linkSource,
        }); // ](url)
        i = closeParen + 1;
        continue;
      }
    }

    const isEscaped = i > 0 && line[i - 1] === "\\";

    // Strong **...**
    if (!isEscaped && line[i] === "*" && line[i + 1] === "*") {
      let close = line.indexOf("**", i + 2);
      while (close !== -1 && line[close - 1] === "\\") {
        close = line.indexOf("**", close + 1);
      }
      if (close !== -1 && close > i + 2) {
        out.push({ from: i, to: i + 2, kind: "mark" });
        out.push({ from: i + 2, to: close, kind: "strong" });
        out.push({ from: close, to: close + 2, kind: "mark" });
        i = close + 2;
        continue;
      }
    }

    // Strikethrough ~~...~~
    if (!isEscaped && line[i] === "~" && line[i + 1] === "~") {
      let close = line.indexOf("~~", i + 2);
      while (close !== -1 && line[close - 1] === "\\") {
        close = line.indexOf("~~", close + 1);
      }
      if (close !== -1 && close > i + 2) {
        out.push({ from: i, to: i + 2, kind: "mark" });
        out.push({ from: i + 2, to: close, kind: "strike" });
        out.push({ from: close, to: close + 2, kind: "mark" });
        i = close + 2;
        continue;
      }
    }

    // Emphasis *...* (single asterisk, not part of **)
    if (!isEscaped && line[i] === "*" && line[i + 1] !== "*") {
      let j = i + 1;
      while (j < line.length) {
        const escapedCloser =
          line[j - 1] === "\\" || (line[j - 1] === "*" && line[j - 2] === "\\");
        if (line[j] === "*" && !escapedCloser) {
          // A `**` run is never an emphasis closer — skip the whole run.
          if (line[j + 1] === "*") {
            j += 2;
            continue;
          }
          break;
        }
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

/** Find a delimiter that is not escaped by an odd run of backslashes. */
function findUnescaped(line: string, delimiter: string, from: number): number {
  for (let index = from; index < line.length; index++) {
    if (line[index] !== delimiter) continue;
    let slashes = 0;
    for (
      let previous = index - 1;
      previous >= 0 && line[previous] === "\\";
      previous--
    ) {
      slashes++;
    }
    if (slashes % 2 === 0) return index;
  }
  return -1;
}
