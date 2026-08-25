import MarkdownIt from "markdown-it";
import {
  extractFirstHeadingTitle,
  parseFrontmatter,
  stripFrontmatter,
} from "./frontmatter";
import { highlightFencedCode } from "./code-highlight";

const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

function isSafeLinkUrl(url: string): boolean {
  const value = url.trim();
  if (/^(https?:|mailto:)/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(decodeURIComponent(value))) return false;
  } catch {
    // The raw scheme check already rejects explicit unsafe schemes.
  }
  return true;
}

const md = new MarkdownItCtor({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(source, info) {
    return highlightFencedCode(source, info) || "";
  },
});

md.validateLink = isSafeLinkUrl;

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrJoin("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ||
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("referrerpolicy", "no-referrer");
  return defaultImage(tokens, idx, options, env, self);
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdownCore(source: string): string {
  try {
    const { body } = stripFrontmatter(source || "");
    const html = md.render(body);
    if (!html || !html.trim()) {
      return `<p class="zotero-markdown-preview-empty"><em>(empty)</em></p>`;
    }
    return html;
  } catch (error) {
    return `<pre class="zotero-markdown-preview-error">${escapeHtml(
      String(error),
    )}\n\n${escapeHtml(source)}</pre>`;
  }
}

export function documentTitleCore(
  source: string,
  fallback = "Markdown",
): string {
  const { data } = parseFrontmatter(source || "");
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
  return extractFirstHeadingTitle(source || "") || fallback;
}
