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
 * Returns empty set when the document does not start with a fence.
 */
export function frontmatterLineNumbers(text: string): Set<number> {
  const lines = text.split("\n");
  const set = new Set<number>();
  if (lines.length === 0 || lines[0].trim() !== "---") return set;
  set.add(1);
  for (let i = 1; i < lines.length; i++) {
    set.add(i + 1);
    if (lines[i].trim() === "---") break;
  }
  return set;
}

export function shouldSkipLiveLine(
  lineNumber: number,
  active: Set<number>,
  frontmatter: Set<number>,
): boolean {
  return active.has(lineNumber) || frontmatter.has(lineNumber);
}
