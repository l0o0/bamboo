import type { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import MarkdownIt from "markdown-it";
import { parseInlineL2 } from "./live-preview/inline";

type EditorSyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>["resolveInner"]
>;

const definitions = new WeakMap<EditorState["doc"], Map<string, string>>();
const frontmatterEnds = new WeakMap<EditorState["doc"], number>();
type MarkdownUtils = ReturnType<typeof MarkdownIt>["utils"];
let markdownUtils: MarkdownUtils | undefined;

function utils(): MarkdownUtils {
  return (markdownUtils ??= new MarkdownIt().utils);
}

function destination(value: string): string {
  const raw =
    value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
  // Percent escapes belong to the URL. Decoding them here changes filenames
  // containing encoded '#' or '?' into a fragment or query before navigation.
  return utils().unescapeAll(raw);
}

function labelKey(value: string): string {
  return utils().normalizeReference(value);
}

function frontmatterEnd(state: EditorState): number {
  const cached = frontmatterEnds.get(state.doc);
  if (cached !== undefined) return cached;
  let end = 0;
  if (state.doc.line(1).text.trim() === "---") {
    for (let number = 2; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (line.text.trim() === "---" || line.text.trim() === "...") {
        end = line.to;
        break;
      }
    }
  }
  frontmatterEnds.set(state.doc, end);
  return end;
}

/** Resolve only the clicked link from the current document, never a DOM href. */
export function linkTargetAt(
  state: EditorState,
  position: number,
): string | null {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > state.doc.length
  )
    return null;
  const ignoredEnd = frontmatterEnd(state);
  if (ignoredEnd && position <= ignoredEnd) return null;
  const line = state.doc.lineAt(position);
  const tree = ensureSyntaxTree(state, line.to, 30);
  // A partial tree cannot prove that a Wiki-looking string is outside code.
  if (!tree) return null;
  let link: EditorSyntaxNode | null = null;
  let autoLink: EditorSyntaxNode | null = null;
  let bareURL: EditorSyntaxNode | null = null;
  for (
    let node: EditorSyntaxNode | null = tree.resolveInner(position, 1);
    node;
    node = node.parent
  ) {
    if (
      /^(?:Image|InlineCode|FencedCode|CodeBlock|CodeText|HTMLBlock|CommentBlock|HTMLTag|LinkReference)$/.test(
        node.name,
      )
    )
      return null;
    if (node.name === "Link" && !link) link = node;
    if (node.name === "Autolink") autoLink = node;
    if (node.name === "URL" && !bareURL) bareURL = node;
  }
  const url = link?.getChild("URL");
  if (url) return destination(state.sliceDoc(url.from, url.to)) || null;

  const wiki = parseInlineL2(line.text).find(
    (range) =>
      range.kind === "link" &&
      range.href?.startsWith("[[") &&
      position - line.from >= range.from &&
      position - line.from < range.to,
  );
  if (wiki?.href) return wiki.href;

  if (link) {
    const marks = link.getChildren("LinkMark");
    if (marks.length < 2) return null;
    // A valid empty inline destination has no URL node. It must not fall
    // through to a same-named shortcut reference elsewhere in the document.
    if (marks.some((mark) => state.sliceDoc(mark.from, mark.to) === "("))
      return null;
    const label = link.getChild("LinkLabel");
    const explicit = label ? state.sliceDoc(label.from + 1, label.to - 1) : "";
    const key = labelKey(
      explicit || state.sliceDoc(marks[0].to, marks[1].from),
    );
    let targets = definitions.get(state.doc);
    if (!targets) {
      // Definitions can follow the clicked reference. Reuse the language's
      // incremental tree; never start a second whole-document parser here.
      const complete = ensureSyntaxTree(state, state.doc.length, 50);
      if (!complete) return null;
      targets = new Map();
      complete.iterate({
        enter({ node }) {
          if (node.name !== "LinkReference" || node.from < ignoredEnd) return;
          const label = node.getChild("LinkLabel"),
            url = node.getChild("URL");
          if (!label || !url) return;
          const key = labelKey(state.sliceDoc(label.from + 1, label.to - 1));
          if (!targets!.has(key))
            targets!.set(key, destination(state.sliceDoc(url.from, url.to)));
        },
      });
      definitions.set(state.doc, targets);
    }
    return targets.get(key) || null;
  }
  const automaticURL = autoLink?.getChild("URL") ?? bareURL;
  if (!automaticURL) return null;
  const value = destination(state.sliceDoc(automaticURL.from, automaticURL.to));
  return autoLink && /^[^\s:]+@[^\s]+$/.test(value)
    ? `mailto:${value}`
    : value || null;
}

/** Capture the source position before selection reveals hidden Markdown marks. */
export function openEditorLink(
  event: MouseEvent,
  view: EditorView,
  open: (href: string) => void,
): boolean {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return false;
  const rendered = (event.target as Element | null)?.closest?.(
    "[data-zmd-link]",
  );
  let position: number | null;
  try {
    position =
      rendered && view.contentDOM.contains(rendered)
        ? view.posAtDOM(event.target as Node)
        : view.posAtCoords({ x: event.clientX, y: event.clientY });
  } catch {
    return false;
  }
  if (position === null) return false;
  const href = linkTargetAt(view.state, position);
  if (!href) return false;
  open(href);
  event.preventDefault();
  return true;
}
