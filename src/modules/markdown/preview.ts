import MarkdownIt from "markdown-it";
import { stripFrontmatter } from "./frontmatter";

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
});

/**
 * Render markdown source to an HTML string (safe: html input disabled).
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
    ztoolkit.log("Markdown preview render failed", e);
    return `<pre class="zotero-markdown-preview-error">${escapeHtml(
      String(e),
    )}\n\n${escapeHtml(source)}</pre>`;
  }
}

/**
 * Write rendered markdown into a host element.
 * Prefer DOMParser + importNode so chrome/XUL doesn't strip content oddly.
 */
export function mountPreviewHtml(host: HTMLElement, source: string): void {
  const html = renderMarkdown(source);
  const doc = host.ownerDocument || (globalThis as any).document;
  try {
    const parsed = new doc.defaultView.DOMParser().parseFromString(
      `<div class="zotero-markdown-preview-inner">${html}</div>`,
      "text/html",
    );
    const inner = parsed.body.firstElementChild;
    host.replaceChildren();
    if (inner) {
      host.appendChild(doc.importNode(inner, true));
    } else {
      host.textContent = source || "";
    }
  } catch (e) {
    ztoolkit.log("mountPreviewHtml fallback to innerHTML", e);
    host.innerHTML = html;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
