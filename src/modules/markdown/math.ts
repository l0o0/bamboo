import MarkdownIt from "markdown-it";
import { katex } from "@mdit/plugin-katex";

const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

/** A numbered equation requires KaTeX's display mode, even inside \(...\). */
export function hasMathTag(source: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*\\tag\*?\s*\{/u.test(source);
}

function asSpan(html: string): string {
  return html
    .replace(/^<p\b([^>]*)>/u, "<span$1>")
    .replace(/<\/p>\s*$/u, "</span>");
}

/** Shared safe MathML output: no trusted HTML commands or persistent macros. */
export function configureMath(md: InstanceType<typeof MarkdownIt>): void {
  md.use(katex, {
    delimiters: "all",
    output: "mathml",
    trust: false,
    throwOnError: false,
    maxExpand: 1000,
    maxSize: 20,
    mathFence: true,
  });
  const inline = md.renderer.rules.math_inline!;
  const block = md.renderer.rules.math_block!;
  md.renderer.rules.math_inline = (tokens, index, options, env, self) =>
    hasMathTag(tokens[index].content)
      ? asSpan(block(tokens, index, options, env, self))
      : inline(tokens, index, options, env, self);
}

const renderer = new MarkdownItCtor("zero", { html: false });
configureMath(renderer);
// Render TeX directly, without interpreting its braces, underscores or escapes
// as Markdown. md.render also runs the plugin's per-render macro cleanup.
renderer.core.ruler.push("zmd_math_only", (state) => {
  const display = !!state.env.displayMath || hasMathTag(state.src);
  const token = new MarkdownItCtor.Token(
    display ? "math_block" : "math_inline",
    "math",
    0,
  );
  token.content = state.src;
  state.tokens = [token];
});

export function renderMath(source: string, displayMode: boolean): string {
  return asSpan(renderer.render(source, { displayMath: displayMode }));
}
