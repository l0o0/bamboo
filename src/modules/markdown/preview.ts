import MarkdownIt from "markdown-it";
import {
  extractFirstHeadingTitle,
  parseFrontmatter,
  stripFrontmatter,
} from "./frontmatter";
import { normalizeAssetReference } from "./images/model";
import type { ImageAssetMap } from "./editor-protocol";
import { THEME_TOKENS, themeTokenCss } from "./theme-tokens";
import { highlightFencedCode } from "./code-highlight";

// esbuild / CJS interop: some builds expose the ctor on .default
const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

const md = new MarkdownItCtor({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(source, info) {
    return highlightFencedCode(source, info) || "";
  },
});

export interface ReadOnlyDocument {
  title: string;
  bodyHtml: string;
  standaloneHtml: string;
}

/**
 * Render markdown source to an HTML fragment (html input disabled).
 * YAML frontmatter is stripped so it does not pollute the preview.
 */
export function renderMarkdown(source: string): string {
  try {
    const { body } = stripFrontmatter(source || "");
    const html = md.render(body);
    if (!html || !html.trim()) {
      return `<p class="zotero-markdown-preview-empty"><em>(empty)</em></p>`;
    }
    return html;
  } catch (e) {
    return `<pre class="zotero-markdown-preview-error">${escapeHtml(
      String(e),
    )}\n\n${escapeHtml(source)}</pre>`;
  }
}

export function documentTitle(source: string, fallback = "Markdown"): string {
  const { data } = parseFrontmatter(source || "");
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
  return extractFirstHeadingTitle(source || "") || fallback;
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
  const bodyHtml = applyAssetsToHtml(
    renderMarkdown(options.source),
    options.assets || {},
  );
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
export function mountPreviewHtml(host: HTMLElement, source: string): void {
  const doc = host.ownerDocument || (globalThis as any).document;
  const rendered = buildStandaloneDocument({ source });
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
  title.textContent = "只读预览";
  const hint = doc.createElement("span");
  hint.textContent = "此页用于阅读，并作为 HTML / PDF 导出原稿";
  label.append(title, hint);
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "zotero-markdown-preview-back";
  back.dataset.action = "preview-back";
  back.textContent = "返回编辑";
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

  page.append(bar, article);
  host.appendChild(page);
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
    placeholder.textContent = resolved?.error || "图片缺失或尚未同步";
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute(
      "aria-label",
      image.getAttribute("alt") || "图片缺失",
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
