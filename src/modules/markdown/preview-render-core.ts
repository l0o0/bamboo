import MarkdownIt from "markdown-it";
import { configureMath } from "./math";
import { footnote } from "@mdit/plugin-footnote";
import {
  extractFirstHeadingTitle,
  parseFrontmatter,
  stripFrontmatter,
} from "./frontmatter";
import { highlightFencedCode } from "./code-highlight";
import { parseDocumentLink, isPdfDocumentLink } from "./document-link-shared";
import { parseNoteLink } from "./note-links";
import { parseHtmlImage } from "./images/html";
import { parseWikiImage } from "./images/reference";
import {
  isSafeAttachmentDataUrl,
  MAX_ATTACHMENT_BYTES,
} from "../../../packages/whiteboard/src/model/file-attachment";

const MarkdownItCtor: typeof MarkdownIt =
  typeof MarkdownIt === "function"
    ? MarkdownIt
    : (MarkdownIt as unknown as { default: typeof MarkdownIt }).default;

function isSafeLinkUrl(url: string): boolean {
  // Zotero links are persisted in one exact canonical form. Do not trim here,
  // otherwise renderer and navigation would disagree about malformed URIs.
  if (parseDocumentLink(url) || isPdfDocumentLink(url)) return true;
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

md.use(footnote);
configureMath(md);

// Sized images have one small HTML vocabulary. Keep general HTML disabled.
md.inline.ruler.before("html_inline", "zmd_sized_image", (state, silent) => {
  if (state.src[state.pos] !== "<") return false;
  const image = parseHtmlImage(state.src, state.pos);
  if (!image || !md.validateLink(image.source)) return false;
  if (!silent) {
    const token = state.push("zmd_sized_image", "img", 0);
    token.attrSet("src", image.source);
    token.attrSet("alt", image.alt);
    if (image.title) token.attrSet("title", image.title);
    if (image.width) token.attrSet("width", String(image.width));
    token.attrSet("referrerpolicy", "no-referrer");
  }
  state.pos = image.to;
  return true;
});
md.renderer.rules.zmd_sized_image = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

md.inline.ruler.before("link", "zmd_wiki_image", (state, silent) => {
  if (!state.src.startsWith("![[", state.pos)) return false;
  const image = parseWikiImage(state.src, state.pos);
  if (!image || !md.validateLink(image.source)) return false;
  if (!silent) {
    const token = state.push("zmd_wiki_image", "img", 0);
    token.attrSet("src", state.md.normalizeLink(image.source));
    token.attrSet("alt", image.alt);
    token.attrSet("referrerpolicy", "no-referrer");
    if (image.width) token.attrSet("width", String(image.width));
  }
  state.pos = image.to;
  return true;
});
md.renderer.rules.zmd_wiki_image = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

// Wiki links are rendered as inert spans first. The host resolves their title
// against the current Zotero library when clicked; keeping lookup out of this
// worker-safe renderer prevents stale/local item IDs from entering HTML.
md.inline.ruler.before("link", "zmd_wikilink", (state, silent) => {
  const start = state.pos;
  if (
    state.src.charCodeAt(start) !== 0x5b ||
    state.src.charCodeAt(start + 1) !== 0x5b ||
    (start > 0 && state.src.charCodeAt(start - 1) === 0x21)
  ) {
    return false;
  }
  const end = state.src.indexOf("]]", start + 2);
  if (end <= start + 2) return false;
  const raw = state.src.slice(start + 2, end);
  const parsed = parseNoteLink(`[[${raw}]]`);
  if (!parsed) return false;
  const pipe = raw.indexOf("|");
  const name = (pipe < 0 ? raw : raw.slice(0, pipe)).trim();
  const label = parsed.label ?? name;
  if (!name || !label || name.includes("\n") || label.includes("\n")) {
    return false;
  }
  if (!silent) {
    state.pushPending();
    const token = state.push("zmd_wikilink", "span", 0);
    token.content = label;
    token.attrSet("data-zmd-wikilink", name);
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.zmd_wikilink = (tokens, index) => {
  const token = tokens[index];
  const name = String(token.attrGet("data-zmd-wikilink") || "");
  return `<span class="zmd-wikilink zmd-unresolved-link" role="link" tabindex="0" data-zmd-wikilink="${escapeHtml(name)}">${escapeHtml(token.content)}</span>`;
};

md.validateLink = isSafeLinkUrl;

// markdown-it validates image destinations with the same callback as links.
// Temporarily allow one validated raster data URL only while its image rule is
// parsing `![alt](...)`; ordinary links continue through isSafeLinkUrl.
const defaultImageRule = md.inline.ruler.__rules__.find(
  (rule) => rule.name === "image",
)?.fn;
if (!defaultImageRule) throw new Error("Markdown image rule is unavailable.");
md.inline.ruler.at("image", (state, silent) => {
  const safeDataUrl = safeRasterImageDestination(state);
  if (!safeDataUrl) return defaultImageRule(state, silent);
  const validateLink = state.md.validateLink;
  state.md.validateLink = (url) => url === safeDataUrl || validateLink(url);
  try {
    return defaultImageRule(state, silent);
  } finally {
    state.md.validateLink = validateLink;
  }
});

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

function safeRasterImageDestination(
  state: Parameters<NonNullable<typeof defaultImageRule>>[0],
): string | undefined {
  if (
    state.src.charCodeAt(state.pos) !== 33 ||
    state.src.charCodeAt(state.pos + 1) !== 91
  ) {
    return undefined;
  }
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);
  if (labelEnd < 0 || state.src.charCodeAt(labelEnd + 1) !== 40) {
    return undefined;
  }
  let pos = labelEnd + 2;
  while (pos < state.posMax && /\s/u.test(state.src[pos]!)) pos += 1;
  const result = state.md.helpers.parseLinkDestination(
    state.src,
    pos,
    state.posMax,
  );
  if (!result.ok) return undefined;
  const href = state.md.normalizeLink(result.str);
  if (
    !/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?;base64,/iu.test(
      href,
    ) ||
    !isSafeAttachmentDataUrl(href, MAX_ATTACHMENT_BYTES)
  ) {
    return undefined;
  }
  return href;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdownCore(source: string, docId?: string): string {
  try {
    const { body } = stripFrontmatter(source || "");
    const html = md.render(body, {
      docId: docId ? encodeURIComponent(docId) : undefined,
    });
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
