import { normalizeAssetReference } from "./images/model";
import { getString } from "../../utils/locale";
import type { EditorOutlineItem, ImageAssetMap } from "./editor-protocol";
import { THEME_TOKENS, themeTokenCss } from "./theme-tokens";
import { documentTitleCore, renderMarkdownCore } from "./preview-render-core";

export interface ReadOnlyDocument {
  title: string;
  bodyHtml: string;
  standaloneHtml: string;
}

export function previewOutlineAnchors(
  items: readonly EditorOutlineItem[],
  headingCount: number,
): Array<string | null> {
  return Array.from(
    { length: headingCount },
    (_, index) => items[index]?.id ?? null,
  );
}

/**
 * Render markdown source to an HTML fragment (html input disabled).
 * YAML frontmatter is stripped so it does not pollute the preview.
 */
export function renderMarkdown(source: string): string {
  return renderMarkdownCore(source);
}

export function documentTitle(source: string, fallback = "Markdown"): string {
  return documentTitleCore(source, fallback);
}

export function applyAssetsToHtml(html: string, assets: ImageAssetMap): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (full, prefix: string, src: string, suffix: string) => {
      const reference = normalizeAssetReference(src);
      const dataUrl = reference ? assets[reference]?.dataUrl : undefined;
      return dataUrl ? `${prefix}${dataUrl}${suffix}` : full;
    },
  );
}

/** Printable / exportable prose styles shared by the in-app preview. */
export function previewDocumentCss(): string {
  return `
.zotero-markdown-preview-page {
  margin: 0;
  background: var(--zmd-bg);
  color: var(--zmd-text);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.7;
}
.zotero-markdown-preview-inner {
  max-width: 46em;
  margin: 0 auto;
  padding: 28px 32px;
  background: var(--zmd-surface);
  border: 1px solid var(--zmd-border);
  border-radius: 12px;
  box-shadow: var(--zmd-shadow);
}
.zotero-markdown-preview-empty {
  opacity: 0.55;
  text-align: center;
  padding: 3em 1em;
}
.zotero-markdown-preview-inner h1,
.zotero-markdown-preview-inner h2,
.zotero-markdown-preview-inner h3,
.zotero-markdown-preview-inner h4 {
  margin-top: 1.4em;
  margin-bottom: 0.45em;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--zmd-text);
}
.zotero-markdown-preview-inner h1 {
  font-size: 1.75em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-inner h2 {
  font-size: 1.35em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-inner h3 { font-size: 1.15em; }
.zotero-markdown-preview-inner p { margin: 0.75em 0; }
.zotero-markdown-preview-inner a {
  color: var(--zmd-accent);
  text-decoration: none;
}
.zotero-markdown-preview-inner a:hover { text-decoration: underline; }
.zotero-markdown-preview-inner ul,
.zotero-markdown-preview-inner ol {
  padding-left: 1.4em;
  margin: 0.6em 0;
}
.zotero-markdown-preview-inner li { margin: 0.25em 0; }
.zotero-markdown-preview-inner pre {
  background: var(--zmd-surface-2);
  border: 1px solid var(--zmd-border);
  padding: 12px 14px;
  border-radius: 8px;
  overflow: auto;
  font-size: 0.9em;
  line-height: 1.5;
}
.zotero-markdown-preview-inner code {
  font-family: ui-monospace, "Sarasa Mono SC", SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}
.zotero-markdown-preview-inner :not(pre) > code {
  background: var(--zmd-accent-soft);
  color: var(--zmd-accent-hover);
  padding: 0.12em 0.4em;
  border-radius: 4px;
}
.zotero-markdown-preview-inner .hljs-comment,
.zotero-markdown-preview-inner .hljs-quote {
  color: var(--zmd-code-comment);
}
.zotero-markdown-preview-inner .hljs-keyword,
.zotero-markdown-preview-inner .hljs-selector-tag,
.zotero-markdown-preview-inner .hljs-operator {
  color: var(--zmd-code-keyword);
}
.zotero-markdown-preview-inner .hljs-string,
.zotero-markdown-preview-inner .hljs-regexp,
.zotero-markdown-preview-inner .hljs-addition {
  color: var(--zmd-code-string);
}
.zotero-markdown-preview-inner .hljs-number,
.zotero-markdown-preview-inner .hljs-literal {
  color: var(--zmd-code-number);
}
.zotero-markdown-preview-inner .hljs-title,
.zotero-markdown-preview-inner .hljs-section {
  color: var(--zmd-code-function);
}
.zotero-markdown-preview-inner .hljs-variable,
.zotero-markdown-preview-inner .hljs-property,
.zotero-markdown-preview-inner .hljs-attr {
  color: var(--zmd-code-variable);
}
.zotero-markdown-preview-inner .hljs-name,
.zotero-markdown-preview-inner .hljs-tag {
  color: var(--zmd-code-tag);
}
.zotero-markdown-preview-inner .hljs-punctuation {
  color: var(--zmd-code-punctuation);
}
.zotero-markdown-preview-inner .hljs-deletion {
  color: var(--zmd-code-invalid);
}
.zotero-markdown-preview-inner blockquote {
  margin: 1em 0;
  padding: 0.2em 0 0.2em 1em;
  border-left: 3px solid var(--zmd-accent);
  color: var(--zmd-text-muted);
  background: var(--zmd-accent-soft);
  border-radius: 0 6px 6px 0;
}
.zotero-markdown-preview-inner hr {
  border: none;
  border-top: 1px solid var(--zmd-border);
  margin: 1.6em 0;
}
.zotero-markdown-preview-inner table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 0.95em;
}
.zotero-markdown-preview-inner th,
.zotero-markdown-preview-inner td {
  border: 1px solid var(--zmd-border);
  padding: 8px 12px;
}
.zotero-markdown-preview-inner th {
  background: var(--zmd-surface-2);
  font-weight: 600;
}
.zotero-markdown-preview-inner img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
}
@media print {
  .zotero-markdown-preview-page { background: #fff; }
  .zotero-markdown-preview-inner {
    max-width: none;
    border: none;
    box-shadow: none;
    padding: 0;
  }
}
`.trim();
}

export function buildStandaloneDocument(options: {
  source: string;
  assets?: ImageAssetMap;
  title?: string;
  theme?: "light" | "dark";
}): ReadOnlyDocument {
  const title = options.title || documentTitle(options.source);
  return buildStandaloneDocumentFromRendered({
    title,
    bodyHtml: renderMarkdown(options.source),
    assets: options.assets,
    theme: options.theme,
  });
}

export function buildStandaloneDocumentFromRendered(options: {
  title: string;
  bodyHtml: string;
  assets?: ImageAssetMap;
  theme?: "light" | "dark";
}): ReadOnlyDocument {
  const title = options.title || "Markdown";
  const bodyHtml = applyAssetsToHtml(options.bodyHtml, options.assets || {});
  const tokens =
    options.theme === "dark" ? THEME_TOKENS.dark : THEME_TOKENS.light;
  const standaloneHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${themeTokenCss(":root", tokens)}
${previewDocumentCss()}
body { padding: 28px 32px 48px; }
</style>
</head>
<body class="zotero-markdown-preview-page">
<article class="zotero-markdown-preview-inner">${bodyHtml}</article>
</body>
</html>
`;
  return { title, bodyHtml, standaloneHtml };
}

/**
 * Mount a read-only document page. Editing stays in Live/Source;
 * this view is the HTML/PDF export surface.
 */
export function mountPreviewHtml(
  host: HTMLElement,
  rendered: { title: string; bodyHtml: string },
  outlineItems: readonly EditorOutlineItem[] = [],
): void {
  const doc = host.ownerDocument || (globalThis as any).document;
  host.replaceChildren();
  host.setAttribute("aria-readonly", "true");
  host.setAttribute("role", "document");
  host.contentEditable = "false";

  const page = doc.createElement("div");
  page.className = "zotero-markdown-preview-page";

  const bar = doc.createElement("header");
  bar.className = "zotero-markdown-preview-bar";
  const label = doc.createElement("div");
  label.className = "zotero-markdown-preview-bar-copy";
  const title = doc.createElement("strong");
  title.textContent = getString("preview-title");
  const hint = doc.createElement("span");
  hint.textContent = getString("preview-hint");
  label.append(title, hint);
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "zotero-markdown-preview-back";
  back.dataset.action = "preview-back";
  back.textContent = getString("preview-back");
  bar.append(label, back);

  const article = doc.createElement("article");
  article.className = "zotero-markdown-preview-inner";
  try {
    const view = doc.defaultView;
    if (view?.DOMParser) {
      const parsed = new view.DOMParser().parseFromString(
        `<div>${rendered.bodyHtml}</div>`,
        "text/html",
      );
      const inner = parsed.body.firstElementChild;
      if (inner) {
        for (const child of Array.from(inner.childNodes)) {
          article.appendChild(doc.importNode(child, true));
        }
      }
    } else {
      article.innerHTML = rendered.bodyHtml;
    }
  } catch (e) {
    ztoolkit.log("mountPreviewHtml fallback to innerHTML", e);
    article.innerHTML = rendered.bodyHtml;
  }

  const headings = Array.from(
    article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  const anchors = previewOutlineAnchors(outlineItems, headings.length);
  headings.forEach((heading, index) => {
    const outlineID = anchors[index];
    if (outlineID) heading.dataset.zmdOutlineId = outlineID;
  });

  page.append(bar, article);
  host.appendChild(page);
}

export function scrollPreviewToOutline(
  host: HTMLElement,
  outlineID: string,
): boolean {
  const heading = Array.from(
    host.querySelectorAll<HTMLElement>("[data-zmd-outline-id]"),
  ).find((element) => element.dataset.zmdOutlineId === outlineID);
  if (!heading) return false;
  heading.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}

export function hydratePreviewImages(
  host: HTMLElement,
  assets: ImageAssetMap,
): void {
  for (const image of host.querySelectorAll("img")) {
    const reference = normalizeAssetReference(image.getAttribute("src") || "");
    if (!reference) continue;
    const resolved = assets[reference];
    if (resolved?.dataUrl) {
      image.setAttribute("src", resolved.dataUrl);
      continue;
    }
    const placeholder = host.ownerDocument.createElement("span");
    placeholder.className = "zotero-markdown-image-missing";
    placeholder.textContent =
      resolved?.error || getString("preview-image-missing");
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute(
      "aria-label",
      image.getAttribute("alt") || getString("preview-image-missing"),
    );
    image.replaceWith(placeholder);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
