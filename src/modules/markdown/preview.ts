import MarkdownIt from "markdown-it";
import { stripFrontmatter } from "./frontmatter";
import { normalizeAssetReference } from "./images/model";
import type { ImageAssetMap } from "./editor-protocol";

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
    const view = doc.defaultView;
    if (!view?.DOMParser) {
      host.innerHTML = html;
      return;
    }
    const parsed = new view.DOMParser().parseFromString(
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
