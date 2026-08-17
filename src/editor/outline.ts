import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type {
  EditorHeadingLevel,
  EditorOutlineItem,
} from "../modules/markdown/editor-protocol";

const HEADING_LEVELS: Record<string, EditorHeadingLevel> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

function frontmatterEnd(doc: string): number {
  if (!doc.startsWith("---\n") && !doc.startsWith("---\r\n")) {
    return 0;
  }
  const match = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(doc.slice(3));
  return match ? 3 + match.index + match[0].length : 0;
}

function displayHeadingText(raw: string, setext: boolean): string {
  return (setext ? raw.split(/\r?\n/, 1)[0] : raw)
    .replace(/^\s{0,3}#{1,6}[ \t]+/, "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\\([\\`*{}[\]()#+.!_>~-])/g, "$1")
    .trim();
}

export function extractEditorOutline(state: EditorState): EditorOutlineItem[] {
  const source = state.doc.toString();
  const ignoredUntil = frontmatterEnd(source);
  const items: EditorOutlineItem[] = [];
  const cursor = syntaxTree(state).cursor();

  do {
    const level = HEADING_LEVELS[cursor.name];
    if (!level || cursor.from < ignoredUntil) continue;
    const text = displayHeadingText(
      state.sliceDoc(cursor.from, cursor.to),
      cursor.name.startsWith("SetextHeading"),
    );
    if (!text) continue;
    items.push({
      id: `h${level}:${cursor.from}`,
      level,
      text,
      from: cursor.from,
    });
  } while (cursor.next());

  return items;
}

export function activeOutlineID(
  items: readonly EditorOutlineItem[],
  position: number,
): string | null {
  if (!Number.isFinite(position) || position < 0) return null;
  let active: string | null = null;
  for (const item of items) {
    if (item.from > position) break;
    active = item.id;
  }
  return active;
}

export function clampOutlinePosition(
  position: number,
  docLength: number,
): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(docLength)) return null;
  return Math.max(0, Math.min(Math.trunc(position), Math.max(0, docLength)));
}
