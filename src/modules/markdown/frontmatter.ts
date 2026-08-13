/**
 * YAML frontmatter helpers for Zotero Markdown notes.
 * Lightweight: no full YAML engine — serialize known fields, parse simple keys.
 */

export interface FrontmatterData {
  title?: string;
  authors?: string[];
  year?: string;
  date?: string;
  doi?: string;
  isbn?: string;
  url?: string;
  itemType?: string;
  citekey?: string;
  tags?: string[];
  /** Zotero item key (parent literature item or note attachment) */
  zoteroKey?: string;
  /** libraryID for API / deep link */
  libraryID?: number;
  /** Canonical zotero://select URI when available */
  zoteroURI?: string;
  /** note | literature */
  type?: string;
  created?: string;
  [key: string]: unknown;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip YAML frontmatter; return body only (for preview). */
export function stripFrontmatter(source: string): {
  body: string;
  frontmatter: string | null;
} {
  const m = source.match(FM_RE);
  if (!m) return { body: source, frontmatter: null };
  return {
    frontmatter: m[1],
    body: source.slice(m[0].length),
  };
}

/** Parse a minimal subset of YAML frontmatter into a flat object. */
export function parseFrontmatter(source: string): {
  data: FrontmatterData;
  body: string;
} {
  const { frontmatter, body } = stripFrontmatter(source);
  if (frontmatter == null) {
    return { data: {}, body: source };
  }
  return { data: parseYamlSimple(frontmatter), body };
}

/** Return the first level-one Markdown heading outside frontmatter. */
export function extractFirstHeadingTitle(source: string): string | null {
  const { body } = stripFrontmatter(source);
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/);
    if (match) {
      const title = match[1].trim();
      return title || null;
    }
  }
  return null;
}

/** Update only frontmatter title while preserving the rest of the document. */
export function syncFrontmatterTitle(source: string, title: string): string {
  const normalized = title.trim();
  if (!normalized) return source;
  const match = source.match(FM_RE);
  if (!match) return source;
  const frontmatter = match[1];
  const titleLine = `title: ${yamlScalar(normalized)}`;
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => /^title:\s*/.test(line));
  if (index >= 0) lines[index] = titleLine;
  else lines.unshift(titleLine);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const start = match.index || 0;
  const updatedBlock = match[0].replace(match[1], lines.join(newline));
  return `${source.slice(0, start)}${updatedBlock}${source.slice(start + match[0].length)}`;
}

export function frontmatterTitleChange(
  source: string,
  title: string,
): { from: number; to: number; insert: string } | null {
  const next = syncFrontmatterTitle(source, title);
  if (next === source) return null;
  let from = 0;
  while (from < source.length && source[from] === next[from]) from++;
  let sourceEnd = source.length;
  let nextEnd = next.length;
  while (
    sourceEnd > from &&
    nextEnd > from &&
    source[sourceEnd - 1] === next[nextEnd - 1]
  ) {
    sourceEnd--;
    nextEnd--;
  }
  return { from, to: sourceEnd, insert: next.slice(from, nextEnd) };
}

/**
 * Build default note content with frontmatter from a Zotero parent item
 * (literature) or a standalone personal note.
 */
export function buildNoteWithFrontmatter(options: {
  title: string;
  parent?: Zotero.Item | null;
  /** When creating under a parent, pass the parent; for top-level notes leave empty */
  includeBodyTitle?: boolean;
}): string {
  const { title, parent, includeBodyTitle = true } = options;
  const data = parent
    ? frontmatterFromItem(parent)
    : frontmatterForPersonalNote(title);

  const yaml = serializeFrontmatter(data);
  const body = includeBodyTitle ? [`# ${title}`, "", ""].join("\n") : "\n";
  return `---\n${yaml}---\n\n${body}`;
}

export function frontmatterFromItem(item: Zotero.Item): FrontmatterData {
  const title = String(item.getField("title") || item.getDisplayTitle() || "");
  const authors = getAuthorNames(item);
  const date = String(item.getField("date") || "");
  const year = extractYear(date) || String(item.getField("year") || "");
  const doi = String(item.getField("DOI") || item.getField("doi") || "");
  const isbn = String(item.getField("ISBN") || item.getField("isbn") || "");
  const url = String(item.getField("url") || "");
  const itemType = item.itemType || "";
  const tags = (item.getTags?.() || [])
    .map((t: { tag?: string } | string) =>
      typeof t === "string" ? t : t.tag || "",
    )
    .filter(Boolean);
  const citekey = getCitekey(item);

  const data: FrontmatterData = {
    title: title || undefined,
    type: "literature",
    itemType: itemType || undefined,
    authors: authors.length ? authors : undefined,
    year: year || undefined,
    date: date || undefined,
    doi: doi || undefined,
    isbn: isbn || undefined,
    url: url || undefined,
    citekey: citekey || undefined,
    tags: tags.length ? tags : undefined,
    zoteroKey: item.key,
    libraryID: item.libraryID,
    zoteroURI: buildZoteroSelectURI(item),
    created: new Date().toISOString().slice(0, 10),
  };

  return omitEmpty(data);
}

export function frontmatterForPersonalNote(title: string): FrontmatterData {
  return omitEmpty({
    title: title || "Note",
    type: "note",
    created: new Date().toISOString().slice(0, 10),
  });
}

/** Serialize FrontmatterData to YAML block body (no surrounding ---). */
export function serializeFrontmatter(data: FrontmatterData): string {
  const lines: string[] = [];
  const order = [
    "title",
    "type",
    "itemType",
    "authors",
    "year",
    "date",
    "doi",
    "isbn",
    "url",
    "citekey",
    "tags",
    "zoteroKey",
    "libraryID",
    "zoteroURI",
    "created",
  ];

  const written = new Set<string>();
  for (const key of order) {
    if (!(key in data) || data[key] === undefined || data[key] === "") continue;
    lines.push(...formatYamlEntry(key, data[key]));
    written.add(key);
  }
  for (const key of Object.keys(data)) {
    if (written.has(key)) continue;
    if (data[key] === undefined || data[key] === "") continue;
    lines.push(...formatYamlEntry(key, data[key]));
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function formatYamlEntry(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    if (!value.length) return [];
    const out = [`${key}:`];
    for (const v of value) {
      out.push(`  - ${yamlScalar(String(v))}`);
    }
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [`${key}: ${value}`];
  }
  return [`${key}: ${yamlScalar(String(value))}`];
}

function yamlScalar(s: string): string {
  // Quote when needed for safe round-trip
  if (
    s === "" ||
    /[:#{}[\],&*?|>!%@`'"\\]/.test(s) ||
    /^\s|\s$/.test(s) ||
    s.includes("\n") ||
    /^(true|false|null|~)$/i.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

/** Very small YAML subset parser (keys, scalars, string lists). */
function parseYamlSimple(yaml: string): FrontmatterData {
  const data: FrontmatterData = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const listKey = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (listKey) {
      const key = listKey[1];
      const arr: string[] = [];
      i++;
      while (i < lines.length) {
        const lm = lines[i].match(/^\s+-\s+(.*)$/);
        if (!lm) break;
        arr.push(unquote(lm[1].trim()));
        i++;
      }
      data[key] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const raw = kv[2].trim();
      if (raw === "") {
        data[key] = "";
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        data[key] = Number(raw);
      } else if (raw === "true" || raw === "false") {
        data[key] = raw === "true";
      } else {
        data[key] = unquote(raw);
      }
    }
    i++;
  }
  // Normalize known aliases
  if (data.authors && !Array.isArray(data.authors)) {
    data.authors = String(data.authors)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return data;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    try {
      if (s.startsWith('"')) return JSON.parse(s);
    } catch {
      // fall through
    }
    return s.slice(1, -1);
  }
  return s;
}

function getAuthorNames(item: Zotero.Item): string[] {
  const creators = item.getCreators?.() || [];
  return creators
    .map((c: any) => {
      if (c.name) return String(c.name);
      const first = c.firstName ? String(c.firstName) + " " : "";
      const last = c.lastName ? String(c.lastName) : "";
      return (first + last).trim();
    })
    .filter(Boolean);
}

function extractYear(date: string): string {
  const m = String(date).match(/(\d{4})/);
  return m ? m[1] : "";
}

function getCitekey(item: Zotero.Item): string {
  // Better BibTeX / Zotero citation key field when present
  try {
    const ck =
      item.getField("citationKey") ||
      item.getField("citekey") ||
      (item as any).getField?.("citationKey");
    if (ck) return String(ck);
  } catch {
    // field may not exist
  }
  const extra = String(item.getField("extra") || "");
  const m =
    extra.match(/^(?:Citation Key|citekey):\s*(.+)$/im) ||
    extra.match(/^Citation Key:\s*(.+)$/im);
  return m ? m[1].trim() : "";
}

function buildZoteroSelectURI(item: Zotero.Item): string | undefined {
  try {
    // zotero://select/library/items/KEY or groups
    if (item.libraryID === Zotero.Libraries.userLibraryID) {
      return `zotero://select/library/items/${item.key}`;
    }
    const lib = Zotero.Libraries.get(item.libraryID);
    if (lib && (lib as any).isGroup) {
      return `zotero://select/groups/${(lib as any).groupID}/items/${item.key}`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function omitEmpty(data: FrontmatterData): FrontmatterData {
  const out: FrontmatterData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}
