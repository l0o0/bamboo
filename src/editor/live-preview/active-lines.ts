import type { DocLines } from "./types";

/** 1-based line numbers covered by selection [from, to] (CM document offsets). */
export function activeLinesFromSelection(
  doc: DocLines,
  from: number,
  to: number,
): Set<number> {
  const out = new Set<number>();
  if (doc.lines < 1) return out;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const start = doc.lineAt(a);
  // Empty selection at end of line: still that line. Non-empty selection
  // that ends at the start of the next line should not include that next line.
  const endPos = a === b ? b : Math.max(a, b - 1);
  const end = doc.lineAt(endPos);
  for (let n = start.number; n <= end.number; n++) out.add(n);
  return out;
}

/**
 * 1-based line numbers of a leading YAML frontmatter block (`---` … `---`).
 * Returns an empty set when the document does not start with a fence, and
 * also when the fence is never closed (a lone `---` is more likely a
 * horizontal rule; treating the whole document as frontmatter would disable
 * live styling for everything).
 */
export function frontmatterLineNumbersFromLines(
  lines: readonly string[],
): Set<number> {
  if (lines.length === 0 || lines[0].trim() !== "---") return new Set();
  const set = new Set<number>();
  set.add(1);
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") return set;
    set.add(i + 1);
  }
  return new Set<number>();
}
