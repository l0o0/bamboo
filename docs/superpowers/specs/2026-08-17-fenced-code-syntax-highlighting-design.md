# Fenced Code Syntax Highlighting Design

## Goal

Add language-aware syntax highlighting for fenced Markdown code blocks while preserving the existing Live editing behavior, sidebar layout, source editing, Preview rendering, HTML export, and PDF export.

The first release supports these language families and common aliases:

- JavaScript and TypeScript: `javascript`, `js`, `jsx`, `typescript`, `ts`, `tsx`
- Data and markup: `json`, `html`, `xml`, `css`, `yaml`, `yml`, `markdown`, `md`
- Shell and query languages: `bash`, `sh`, `shell`, `sql`
- General-purpose languages: `python`, `py`, `java`, `c`, `cpp`, `c++`, `go`, `rust`, `rs`

An empty or unknown fence language remains a plain monospaced code block and must never prevent the document from rendering or being edited.

## Current State

The editor has two independent Markdown rendering paths:

1. Live and Source modes use CodeMirror 6 with `@codemirror/lang-markdown`, GFM, and `syntaxHighlighting(defaultHighlightStyle)`.
2. Preview and standalone export use `markdown-it` to generate HTML.

Live Preview currently identifies fenced code lines only to add line classes, hide inactive fence markers, and paint the code-block background. The Markdown language extension is not given any fenced-code language descriptions, so CodeMirror does not create nested syntax trees for ` ```js `, ` ```python `, and similar blocks.

The existing `markdown-it` instance does not define a `highlight` callback. It therefore emits escaped code inside `<pre><code>` without token markup.

## Chosen Architecture

Syntax highlighting is implemented independently at each renderer boundary:

- CodeMirror owns highlighting in Live and Source modes.
- `markdown-it` plus `highlight.js` owns highlighting in Preview and export modes.
- A small shared language registry owns normalized language names and aliases.
- Shared theme tokens keep both renderers visually consistent without coupling their DOM structures.

`markdown-it` is not used to render Live code blocks. Replacing editable CodeMirror text with generated HTML would break caret mapping, selections, composition input, undo history, and incremental document updates.

## Language Registry

Add a focused module that exposes:

- the supported canonical language names;
- aliases accepted in Markdown fences;
- a normalization function for Preview highlighting;
- CodeMirror `LanguageDescription` entries for the same language set;
- a safe plain-text fallback for unknown languages.

Language matching is case-insensitive and uses only the first whitespace-delimited token in the fence info string. For example, ` ```js title="demo" ` selects JavaScript. Arbitrary fence metadata is not interpreted or rendered as HTML.

The registry is the single source of truth for aliases. Tests must fail if a supported CodeMirror alias cannot be normalized for Preview.

## Live And Source Modes

Configure the existing Markdown extension with `codeLanguages` from the shared registry:

```ts
markdown({
  extensions: GFM,
  codeLanguages,
});
```

CodeMirror then parses the fenced body as a nested language and applies token classes through the existing syntax-highlighting extension.

Live Preview continues to apply `zmd-lp-code-block` and `zmd-lp-code-fence` line decorations. These decorations remain structural only:

- keep the current background, padding, and content-box clipping;
- hide inactive fence markers as today;
- show the source fence on an active fence line;
- do not replace code content with widgets or generated HTML;
- do not add line margins that alter CodeMirror coordinates.

Language support may be represented by lazy `LanguageDescription` loaders, but the packaged Zotero editor remains fully offline. Unsupported languages fall back to Markdown's plain-code parser.

## Preview And Export

Keep `markdown-it` as the HTML renderer and configure its `highlight` option with `highlight.js` core plus only the selected language modules.

The callback behavior is:

1. Normalize the fence language through the shared registry.
2. If the language is supported, call explicit-language highlighting.
3. If it is empty, unknown, or highlighting throws, return safely escaped source.
4. Do not use automatic language detection. It is slower, can produce inconsistent results, and is unnecessary when the Markdown fence supplies a language.

The returned markup contains only highlighter-generated token spans. User-provided HTML remains disabled in `markdown-it`.

Preview, printable HTML, and PDF export already share `renderMarkdown` and `previewDocumentCss`, so they receive the same highlighted output and CSS without separate export logic.

## Theme

Define semantic code-token colors for light and dark themes, covering at least:

- comments;
- keywords and operators;
- strings and inserted values;
- numbers and constants;
- function and class names;
- properties, attributes, and variables;
- tags and punctuation;
- invalid or deleted tokens.

CodeMirror receives a custom `HighlightStyle` based on Lezer highlight tags. Preview receives matching `.hljs-*` rules generated from the same semantic color tokens.

The palette must prioritize readable contrast inside the existing subtle code-block background. Font family, font size, line height, padding, wrapping behavior, and sidebar geometry remain unchanged.

## Performance And Packaging

- Register only the first-release languages rather than importing the full `highlight.js` distribution.
- Keep language loading offline; no CDN, worker, or network request is allowed.
- Avoid language auto-detection in Preview.
- Let CodeMirror parse only fenced regions through its nested-language mechanism.
- Verify the built editor bundle and XPI size before and after the dependency change. A material increase should be documented, and unused language modules must not be retained accidentally.

Because the editor is bundled to one privileged `editor.js`, lazy CodeMirror loaders reduce initialization work but may not reduce the final archive size. Correctness and offline reliability take priority over artificial code splitting.

## Error Handling

- Unknown language: render plain code with the normal code-block style.
- Language module load failure: retain editable plain code and log at most one scoped diagnostic per language.
- Preview highlighter failure: escape the original code and render it without token spans.
- Malformed or unclosed fence: preserve the current Markdown behavior; do not force a highlighted block.
- Theme switch: update token colors without rebuilding or replacing document content.

Highlighting failures must never alter Markdown source, block saving, or make the editor iframe fail to initialize.

## Testing

Add focused tests for:

- canonical names and aliases, including case-insensitive input and fence metadata;
- CodeMirror nested syntax trees for representative JavaScript, Python, HTML, and unknown-language blocks;
- Live decorations coexisting with syntax token classes;
- active and inactive fence marker behavior;
- `markdown-it` output containing token spans for supported languages;
- escaped plain output for unknown languages and highlighter failures;
- shared light and dark token styles;
- Preview and standalone export using the same highlighted HTML;
- no regression to code-block padding, background clipping, selection, editing, or saving;
- successful production build with all language modules available offline.

## Out Of Scope

- Executing code or showing a run button;
- automatic language detection;
- downloading language definitions at runtime;
- line numbers, line highlighting, or filename captions inside code blocks;
- arbitrary fence attributes beyond selecting the language;
- per-document syntax theme selection;
- supporting every language shipped by CodeMirror or `highlight.js` in the first release.

## Acceptance Criteria

1. ` ```js ` and every documented alias produce token highlighting in Live, Source, Preview, HTML export, and PDF export.
2. Light and dark themes remain readable and visually consistent across both rendering paths.
3. Editing, caret placement, text selection, undo/redo, IME input, saving, and sidebar layout continue to work inside highlighted blocks.
4. Empty, unknown, malformed, or failed language highlighting falls back to safe plain code.
5. The feature works entirely offline and passes unit, build, lint, formatting, and runtime checks.
