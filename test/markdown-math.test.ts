import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownCore } from "../src/modules/markdown/preview-render-core.ts";
import { renderMath } from "../src/modules/markdown/math.ts";
import { parseMathRanges } from "../src/editor/live-preview/math-syntax.ts";
import { parseInlineL2 } from "../src/editor/live-preview/inline.ts";

export const EQUATIONS = [
  String.raw`\(\sigma_{c}^{*}=\frac{2 \sum_{s}^{*}}{\Lambda} \tag{1}\)`,
  String.raw`\(\sigma_c^*\)`,
  String.raw`\(\mathrm{S/m}\)`,
  String.raw`\(\nabla \cdot[\sigma^*(x,y,z,\omega)\nabla V^*(x,y,z,\omega)]=-I^*(\omega)\delta(r-r') \tag{3}\)`,
];

test("unclosed and invalid math delimiters do not repeatedly scan the remaining document", () => {
  for (const source of [
    "\\( unfinished ".repeat(10000),
    "\\[\ntext \\] trailing\n".repeat(5000),
    "$x trailing $ invalid ".repeat(10000),
    "` ".repeat(10000) + "\\( unfinished ".repeat(10000),
  ]) {
    const originalIndexOf = String.prototype.indexOf;
    const originalSlice = String.prototype.slice;
    let examined = 0;
    String.prototype.indexOf = function (search, from = 0) {
      examined += Math.max(0, this.length - from);
      return originalIndexOf.call(this, search, from);
    };
    String.prototype.slice = function (start = 0, end = this.length) {
      examined += Math.max(0, end - start);
      return originalSlice.call(this, start, end);
    };
    try {
      parseMathRanges(source);
    } finally {
      String.prototype.indexOf = originalIndexOf;
      String.prototype.slice = originalSlice;
    }
    assert.ok(
      examined <= source.length * 8,
      `bounded string scans: ${examined} for ${source.length} source characters`,
    );
  }
});

test("reading mode renders the reported bracket equations including inline tags", () => {
  const html = renderMarkdownCore(EQUATIONS.join("\n\n- "));
  assert.equal((html.match(/<math\b/g) ?? []).length, 4);
  assert.doesNotMatch(html, /katex-error|<p>\s*<p\b/);
  assert.match(html, /<annotation[^>]*>[^<]*\\tag\{1\}/);
  assert.match(html, /<annotation[^>]*>[^<]*\\tag\{3\}/);
  assert.equal((html.match(/<math[^>]*display="block"/g) ?? []).length, 2);
});

test("reading and live syntax accept all four delimiters and multiline math", () => {
  for (const source of [
    "$x^2$",
    "$$\\frac{1}{2}$$",
    String.raw`\(x^2\)`,
    String.raw`\[\frac{1}{2}\]`,
    "$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$",
    "\\[\n\\frac{1}{2}\n\\]",
    "Before \\(x +\ny\\) after",
    "$x +\ny$",
  ]) {
    const html = renderMarkdownCore(source);
    assert.match(html, /<math\b/, source);
    assert.doesNotMatch(html, /katex-error/, source);
    const ranges = parseMathRanges(source);
    assert.equal(ranges.length, 1, source);
    assert.equal(
      source.slice(ranges[0].from, ranges[0].to).includes("x") ||
        ranges[0].content.includes("frac"),
      true,
    );
  }
});

test("code, escaped delimiters, currency and incomplete formulas stay literal", () => {
  for (const source of [
    "`$x$`",
    "`\\(x\\)`",
    "``code ` \\(x\\)``",
    String.raw`\$5 and $10`,
    "Cost $5 and $10 per unit",
    String.raw`\\(x\\)`,
    String.raw`\(x`,
  ]) {
    assert.equal(parseMathRanges(source).length, 0, source);
    assert.doesNotMatch(renderMarkdownCore(source), /<math\b/, source);
  }
  assert.doesNotMatch(
    renderMarkdownCore("```tex\n\\(x\\)\n$x$\n```"),
    /<math\b/,
  );
  assert.doesNotMatch(renderMarkdownCore("    \\(x\\)"), /<math\b/);
  // Keep the existing explicit math-fence convention in reading mode.
  assert.match(renderMarkdownCore("```math\nx^2\n```"), /<math\b/);
});

test("TeX underscores and stars are not reparsed as Markdown emphasis or links", () => {
  for (const equation of EQUATIONS) {
    assert.deepEqual(parseInlineL2(equation), []);
    assert.equal(parseMathRanges(equation).length, 1);
  }
  assert.ok(
    parseInlineL2("**before** \\(x^*\\) **after**").some(
      (range) => range.kind === "strong",
    ),
  );
});

test("safe MathML disallows trusted commands and resets macros between renders", () => {
  for (const source of [
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\htmlClass{unsafe}{x}`,
    String.raw`\includegraphics{https://tracker.test/a.png}`,
  ]) {
    const html = renderMath(source, false);
    assert.doesNotMatch(html, /href=|<img\b|class="unsafe"/);
  }
  assert.doesNotMatch(
    renderMath(String.raw`\gdef\privateMacro{a}\privateMacro`, false),
    /katex-error/,
  );
  assert.match(
    renderMath(String.raw`\privateMacro`, false),
    /<mtext>\\privateMacro<\/mtext>/,
  );
  assert.match(renderMath(String.raw`\frac{`, false), /katex-error/);
  assert.doesNotMatch(
    renderMath(String.raw`\gdef\loop{\loop}\loop`, false),
    /<script|href=/,
  );
});
