import { parser as markdownParser } from "@lezer/markdown";
import MarkdownIt from "markdown-it";
import {
  extractNoteLinks,
  formatNoteLink,
  noteIgnoredRanges,
  resolveNoteLink,
  portableNoteFilename,
  type PortableNote,
  type NoteDocument,
} from "./note-links";
import { noteMetadata, readLibraryNotes } from "./note-library";
import { parseMarkdownImages } from "./images/model";

export interface NoteExportFile {
  path: string;
  content: string;
}

export interface NoteExportAsset {
  libraryID: number;
  key: string;
  reference: string;
  path: string;
}

export interface NoteExportPlan {
  files: NoteExportFile[];
  assets: NoteExportAsset[];
  warnings: string[];
}

export interface NoteExportOptions {
  format?: "wiki" | "markdown";
  rewriteNoteLinks?: boolean;
  wikiImageBase?: "assets" | "sibling";
  /** `${libraryID}:${key}:${reference}` -> relative exported image path. */
  assetPaths?: ReadonlyMap<string, string>;
}

const markdownUtils = new MarkdownIt().utils;

function warning(kind: string, note: PortableNote, href: string): string {
  return `${kind} in ${note.filename}: ${href}`;
}

function explicitLinkLabel(link: {
  href: string;
  label: string;
  syntax: string;
}): string | undefined {
  if (link.syntax !== "wiki") return link.label;
  const inner =
    link.href.startsWith("[[") && link.href.endsWith("]]")
      ? link.href.slice(2, -2)
      : "";
  return inner.includes("|") ? link.label : undefined;
}

function inRange(
  position: number,
  ranges: readonly { from: number; to: number }[],
): boolean {
  return ranges.some(({ from, to }) => position >= from && position < to);
}

/** Only explicit relative image paths are copied; never URLs or absolute files. */
function relativeImageReference(reference: string): string | null {
  if (
    !reference ||
    /^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(reference) ||
    /[\\:*?<>|]/.test(reference) ||
    [...reference].some((character) => character.charCodeAt(0) < 32)
  )
    return null;
  const parts: string[] = [];
  for (const part of reference.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  const normalized = parts.join("/");
  return /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i.test(normalized)
    ? normalized
    : null;
}

function assetOutputPath(note: PortableNote, name: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(note.key)) return null;
  return `assets/${note.key}/${name}`;
}

function noteOutputPath(note: PortableNote): string | null {
  const path = portableNoteFilename(note);
  return path && !/[\\/\0]/.test(path) ? path : null;
}

function replaceImageReference(
  source: string,
  image: { from: number; to: number; source: string },
  replacement: string,
): { from: number; to: number; insert: string } | null {
  const segment = source.slice(image.from, image.to);
  const markdownStart = segment.indexOf("](");
  if (markdownStart >= 0) {
    const imageNode = markdownParser
      .parse(segment)
      .topNode.getChild("Paragraph")
      ?.getChild("Image");
    const url = imageNode?.getChild("URL");
    if (url) {
      const raw = segment.slice(url.from, url.to);
      const angled = raw.startsWith("<") && raw.endsWith(">");
      return {
        from: image.from + url.from + (angled ? 1 : 0),
        to: image.from + url.to - (angled ? 1 : 0),
        insert: replacement,
      };
    }
  }
  if (/^<img\b/i.test(segment)) {
    // Match complete attributes with the same token rules as parseHtmlImage.
    // Searching for "src=" alone also matches data-src and quoted alt/title
    // contents, leaving the actual image URL unchanged after its file moves.
    const pattern = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const attr of segment.slice(4, -1).matchAll(pattern)) {
      if (attr[1].toLowerCase() !== "src") continue;
      const value = attr[2] ?? attr[3] ?? attr[4];
      const quoted = attr[2] !== undefined || attr[3] !== undefined;
      const valueStart =
        4 + attr.index + attr[0].length - value.length - (quoted ? 1 : 0);
      return {
        from: image.from + valueStart,
        to: image.from + valueStart + value.length,
        insert: replacement,
      };
    }
  }
  return null;
}

function encodeAssetPath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function wikiImageReferences(source: string): {
  from: number;
  to: number;
  source: string;
  wiki: true;
  alias: string;
}[] {
  return [...source.matchAll(/!\[\[([^\]\n]+)\]\]/g)]
    .filter(
      (match) =>
        (source.slice(0, match.index).match(/\\+$/)?.[0].length || 0) % 2 === 0,
    )
    .map((match) => ({
      from: match.index!,
      to: match.index! + match[0].length,
      source: match[1].split("|", 1)[0].trim(),
      wiki: true as const,
      alias: match[1].split("|").slice(1).join("|"),
    }));
}

function referenceImages(source: string) {
  const definitions = new Map<
    string,
    { from: number; to: number; source: string; definition: true }
  >();
  const labels = new Set<string>();
  const normalize = markdownUtils.normalizeReference;
  markdownParser.parse(source).iterate({
    enter({ node }) {
      if (node.name === "LinkReference") {
        const label = node.getChild("LinkLabel");
        const url = node.getChild("URL");
        if (!label || !url) return;
        const key = normalize(source.slice(label.from + 1, label.to - 1));
        if (definitions.has(key)) return;
        const raw = source.slice(url.from, url.to);
        const angled = raw.startsWith("<") && raw.endsWith(">");
        definitions.set(key, {
          from: url.from + (angled ? 1 : 0),
          to: url.to - (angled ? 1 : 0),
          source: markdownUtils.unescapeAll(angled ? raw.slice(1, -1) : raw),
          definition: true,
        });
      } else if (node.name === "Image" && !node.getChild("URL")) {
        if (
          node
            .getChildren("LinkMark")
            .some((mark) => source.slice(mark.from, mark.to) === "(")
        )
          return;
        const label = node.getChild("LinkLabel");
        const explicit = label
          ? source.slice(label.from + 1, label.to - 1)
          : "";
        const alt =
          /^!\[([^\]]*)\]/.exec(source.slice(node.from, node.to))?.[1] ?? "";
        labels.add(normalize(explicit || alt));
      }
    },
  });
  return [...labels].flatMap((label) =>
    definitions.has(label) ? [definitions.get(label)!] : [],
  );
}

function inlineImages(source: string) {
  const images: Array<{ from: number; to: number; source: string }> = [];
  markdownParser.parse(source).iterate({
    enter({ node }) {
      if (node.name !== "Image") return;
      const url = node.getChild("URL");
      if (!url) return;
      const raw = source.slice(url.from, url.to);
      images.push({
        from: node.from,
        to: node.to,
        source: markdownUtils.unescapeAll(
          raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw,
        ),
      });
    },
  });
  return images;
}

function buildNoteContent(
  note: NoteDocument,
  notes: readonly NoteDocument[],
  format: "wiki" | "markdown",
  assets: NoteExportAsset[],
  warnings: string[],
  options: NoteExportOptions,
): string | null {
  if (note.readError) {
    warnings.push(`Unable to read ${note.filename}: ${note.readError}`);
    return null;
  }
  const source = note.content;
  const replacements: { from: number; to: number; insert: string }[] = [];
  const links =
    options.rewriteNoteLinks === false ? [] : extractNoteLinks(source);
  for (const link of links) {
    const resolved = resolveNoteLink(link.href, note, notes);
    if (resolved.status === "resolved") {
      const label = explicitLinkLabel(link);
      const segment = source.slice(link.from, link.to);
      if (
        link.syntax === "markdown" &&
        /!\[|<img\b/i.test(segment) &&
        (inlineImages(segment).length > 0 ||
          parseMarkdownImages(segment).some((image) => image.syntax === "html"))
      ) {
        const url = markdownParser
          .parse(segment)
          .topNode.getChild("Paragraph")
          ?.getChild("Link")
          ?.getChild("URL");
        if (url) {
          const raw = segment.slice(url.from, url.to);
          const angled = raw.startsWith("<") && raw.endsWith(">");
          // Retain this link's Markdown label so its image can be rewritten
          // independently. A whole-link replacement overlaps that image, and
          // a Wiki alias cannot preserve the embedded Markdown image markup.
          const destination = formatNoteLink(resolved.note, {
            format: "markdown",
            label: "",
            ...(resolved.heading ? { heading: resolved.heading } : {}),
          }).slice(3, -1); // Keep the destination inside the empty label wrapper.
          replacements.push({
            from: link.from + url.from + (angled ? 1 : 0),
            to: link.from + url.to - (angled ? 1 : 0),
            insert: destination,
          });
          continue;
        }
      }
      replacements.push({
        from: link.from,
        to: link.to,
        insert: formatNoteLink(resolved.note, {
          format,
          ...(resolved.heading ? { heading: resolved.heading } : {}),
          ...(label ? { label } : {}),
        }),
      });
    } else if (resolved.status === "ambiguous") {
      warnings.push(warning("Ambiguous internal note link", note, link.href));
    } else if (resolved.status === "unresolved") {
      warnings.push(warning("Unresolved internal note link", note, link.href));
    }
  }

  const ignored = noteIgnoredRanges(source);
  const imageReplacements: {
    from: number;
    to: number;
    insert: string;
    reference: string;
    path: string;
  }[] = [];
  const images = [
    // Wiki occurrences and reference definitions have their own export rules.
    // The shared parser also returns them for previews and asset cleanup.
    ...parseMarkdownImages(source).filter((image) => {
      const literal = source.slice(image.from, image.to);
      return /^<img\b/i.test(literal);
    }),
    ...inlineImages(source),
    ...referenceImages(source),
    ...wikiImageReferences(source),
  ] as Array<{
    from: number;
    to: number;
    source: string;
    wiki?: true;
    alias?: string;
    definition?: true;
  }>;
  images.sort((a, b) => a.from - b.from);
  const localPaths = new Map<string, string>();
  for (const image of images) {
    if (inRange(image.from, ignored)) continue;
    if ((source.slice(0, image.from).match(/\\+$/)?.[0].length || 0) % 2)
      continue;
    const isWikiImage = image.wiki === true;
    let reference = image.source.replace(/^zotero-md:\/\/asset\//, "assets/");
    // Markdown/HTML destinations are URLs; wiki image filenames are literal.
    if (!isWikiImage) {
      try {
        reference = decodeURIComponent(reference);
      } catch {
        warnings.push(
          `Unable to export asset ${image.source}: invalid URL encoding`,
        );
        continue;
      }
    }
    if (
      isWikiImage &&
      options.wikiImageBase !== "sibling" &&
      !reference.includes("/")
    )
      reference = `assets/${reference}`;
    const normalized = relativeImageReference(reference);
    if (!normalized) {
      if (isWikiImage || !/^(?:https?:|data:|\/\/)/i.test(reference))
        warnings.push(
          `Unable to export asset ${image.source}: unsupported or unsafe reference`,
        );
      continue;
    }
    reference = normalized;
    const name =
      reference.startsWith("assets/") && reference.split("/").length === 2
        ? reference.slice("assets/".length)
        : `linked/${localPaths.size + 1}/${reference.split("/").pop()}`;
    const mapped = options.assetPaths?.get(
      `${note.libraryID}:${note.key}:${reference}`,
    );
    if (
      mapped &&
      (relativeImageReference(mapped) !== mapped ||
        mapped.split("/").includes(".."))
    ) {
      warnings.push(
        `Unable to export asset ${image.source}: invalid mapped output path`,
      );
      continue;
    }
    let path =
      localPaths.get(reference) ?? mapped ?? assetOutputPath(note, name);
    if (
      !localPaths.has(reference) &&
      !mapped &&
      path &&
      [...localPaths.values()].some(
        (value) => value.toLocaleLowerCase() === path!.toLocaleLowerCase(),
      )
    )
      path = assetOutputPath(
        note,
        `linked/${localPaths.size + 1}/${reference.split("/").pop()}`,
      );
    if (path) localPaths.set(reference, path);
    if (!path) {
      warnings.push(`Unable to export asset ${image.source}: invalid note key`);
      continue;
    }
    const encodedPath = encodeAssetPath(path);
    let replacement;
    if (isWikiImage) {
      const alias = image.alias ?? "";
      const size = /^(\d+)(?:x(\d+))?$/.exec(alias);
      const label = alias.replace(/([\\[\]])/g, "\\$1");
      const insert =
        format === "wiki"
          ? `![[${path}${alias ? `|${alias}` : ""}]]`
          : size
            ? `<img src="${encodedPath}" width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}>`
            : `![${label}](${encodedPath})`;
      replacement = { from: image.from, to: image.to, insert };
    } else if (image.definition) {
      replacement = { from: image.from, to: image.to, insert: encodedPath };
    } else {
      replacement = replaceImageReference(source, image, encodedPath);
    }
    if (!replacement) {
      warnings.push(
        `Unable to rewrite asset ${image.source} in ${note.filename}`,
      );
      continue;
    }
    imageReplacements.push({
      ...replacement,
      reference,
      path,
    });
  }

  const assetSet = new Set<string>();
  for (const image of imageReplacements) {
    const key = `${note.libraryID}:${note.key}:${image.reference}`;
    if (!assetSet.has(key)) {
      assetSet.add(key);
      assets.push({
        libraryID: note.libraryID,
        key: note.key,
        reference: image.reference,
        path: image.path,
      });
    }
    replacements.push({
      from: image.from,
      to: image.to,
      insert: image.insert,
    });
  }

  replacements.sort((a, b) => b.from - a.from);
  let result = source;
  let end = source.length;
  for (const replacement of replacements) {
    if (replacement.to > end) continue;
    result =
      result.slice(0, replacement.from) +
      replacement.insert +
      result.slice(replacement.to);
    end = replacement.from;
  }
  return result;
}

export function buildNoteExport(
  notes: readonly NoteDocument[],
  options: NoteExportOptions = {},
): NoteExportPlan {
  const format = options.format ?? "wiki";
  const files: NoteExportFile[] = [];
  const assets: NoteExportAsset[] = [];
  const warnings: string[] = [];
  const byKey = new Map<string, NoteExportAsset>();
  const portableNotes = notes.filter((note) => !note.readError);
  for (const note of notes) {
    const content = buildNoteContent(
      note,
      portableNotes,
      format,
      assets,
      warnings,
      options,
    );
    if (content === null) continue;
    const path = noteOutputPath(note);
    if (!path) {
      warnings.push(`Unable to export ${note.filename}: invalid note key`);
      continue;
    }
    files.push({ path, content });
  }
  // Keep asset plans deterministic and de-duplicate references across image
  // syntaxes without depending on object identity.
  for (const asset of assets) {
    const id = `${asset.libraryID}:${asset.key}:${asset.reference}`;
    if (!byKey.has(id)) byKey.set(id, asset);
  }
  return { files, assets: [...byKey.values()], warnings };
}

function parentDirectory(path: string): string | null {
  if (!path || typeof path !== "string") return null;
  if (
    path.includes("\0") ||
    path.split(/[\\/]/).includes("..") ||
    !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)
  )
    return null;
  try {
    const parent = PathUtils.parent(path);
    return parent && parent !== path ? parent : null;
  } catch {
    return null;
  }
}

export function sourceAssetPath(
  note: NoteDocument,
  reference: string,
): string | null {
  const relative = relativeImageReference(reference);
  let parent = parentDirectory(note.path || "");
  if (!relative || !parent) return null;
  const parts = relative.split("/");
  while (parts[0] === "..") {
    parts.shift();
    const next: string | null = PathUtils.parent(parent);
    if (!next || next === parent) return null;
    parent = next;
  }
  return PathUtils.join(parent, ...parts);
}

/** Local images must be real files, not links to another attachment or private file. */
export async function assertRegularImageFile(source: string) {
  if (!(await IOUtils.exists(source)))
    throw new Error(`Local image is unavailable: ${source}`);
  const pathToFile = Zotero.File.pathToFile;
  if (typeof pathToFile === "function") {
    const file = pathToFile.call(Zotero.File, source) as {
      isSymlink?: () => boolean;
    };
    if (file.isSymlink?.())
      throw new Error(`Symbolic-link images cannot be transferred: ${source}`);
  }
  const info = await IOUtils.stat(source);
  if (info.type && info.type !== "regular")
    throw new Error(`Local image is not a file: ${source}`);
  return info;
}

function assertUnchangedStamp(
  before: { size?: number; lastModified?: number },
  after: { size?: number; lastModified?: number },
): void {
  if (before.size !== after.size || before.lastModified !== after.lastModified)
    throw new Error("A source file changed during export. Please retry.");
}

async function chooseExportParent(win: Window): Promise<string | null> {
  const picked = await new ztoolkit.FilePicker(
    "Export Markdown notes",
    "folder",
    [],
    undefined,
    win,
  ).open();
  return picked || null;
}

async function createExportDirectory(
  parent: string,
  base = "zotero-markdown-export",
): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(base))
    throw new Error("Invalid export directory name");
  for (let index = 0; index < 1000; index++) {
    const suffix = index ? `-${index}` : "";
    const candidate = PathUtils.join(parent, `${base}${suffix}`);
    if (await IOUtils.exists(candidate)) continue;
    try {
      await IOUtils.makeDirectory(candidate, { ignoreExisting: false });
      return candidate;
    } catch (error) {
      if (await IOUtils.exists(candidate)) continue;
      throw error;
    }
  }
  throw new Error("Could not create a unique export directory");
}

function warningReportPath(files: readonly NoteExportFile[]): string {
  const occupied = new Set(files.map((file) => file.path.toLocaleLowerCase()));
  for (let index = 0; ; index++) {
    const suffix = index ? `-${index}` : "";
    const path = `REPORT${suffix}.md`;
    if (!occupied.has(path.toLocaleLowerCase())) return path;
  }
}

export async function exportNoteLibrary(
  win: Window,
  libraryID: number,
  format: "wiki" | "markdown",
): Promise<{ directory: string; notes: number; warnings: string[] } | null> {
  const notes = await readLibraryNotes(libraryID, { refresh: true });
  const plan = buildNoteExport(
    notes.filter((note) => note.libraryID === libraryID),
    { format },
  );
  const parent = await chooseExportParent(win);
  if (!parent) return null;
  return writeNoteExport(notes, plan, parent);
}

interface PreparedNoteExport {
  notes: NoteDocument[];
  plan: NoteExportPlan;
}

export interface SelectedNoteExportOptions {
  shouldContinue?: () => boolean;
}

export function assertTransferContinues(shouldContinue?: () => boolean): void {
  if (shouldContinue?.() === false)
    throw Object.assign(new Error("Markdown transfer cancelled"), {
      name: "AbortError",
    });
}

/** Read only explicitly selected Markdown attachments; no picker, writes or library scan. */
async function prepareSelectedNotes(
  items: readonly Zotero.Item[],
  format: "wiki" | "markdown" = "markdown",
  options: Pick<SelectedNoteExportOptions, "shouldContinue"> = {},
): Promise<PreparedNoteExport> {
  const notes: NoteDocument[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    assertTransferContinues(options.shouldContinue);
    const metadata = noteMetadata(item);
    if (!metadata) throw new Error("Select Markdown attachments to export");
    const id = `${metadata.libraryID}:${metadata.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const path = await item.getFilePathAsync();
    if (!path)
      throw new Error(`Markdown attachment is unavailable: ${metadata.title}`);
    const before = await IOUtils.stat(path);
    const raw = await Zotero.File.getContentsAsync(path);
    if (typeof raw !== "string")
      throw new Error(`Cannot read Markdown attachment: ${metadata.title}`);
    const after = await IOUtils.stat(path);
    assertUnchangedStamp(before, after);
    notes.push({
      ...metadata,
      path,
      content: raw,
      ...(typeof after.lastModified === "number"
        ? { fileModified: after.lastModified }
        : {}),
      ...(typeof after.size === "number" ? { fileSize: after.size } : {}),
    });
  }
  if (!notes.length) throw new Error("Select Markdown attachments to export");
  const plan = buildNoteExport(notes, { format });
  const paths = new Set<string>();
  for (const file of plan.files) {
    const path = file.path.toLocaleLowerCase();
    if (paths.has(path))
      throw new Error("Selected notes have conflicting export filenames");
    paths.add(path);
  }
  assertTransferContinues(options.shouldContinue);
  return {
    notes,
    plan,
  };
}

/** Export only the menu or toolbar's selection, into an owned new directory. */
export async function exportSelectedNotes(
  win: Window,
  items: readonly Zotero.Item[],
  format: "wiki" | "markdown" = "markdown",
  options: SelectedNoteExportOptions = {},
): Promise<{ directory: string; notes: number; warnings: string[] } | null> {
  const selected = [...items];
  const parent = await chooseExportParent(win);
  if (!parent || options.shouldContinue?.() === false) return null;
  try {
    const tab = await import("./tab");
    await tab.flushMarkdownItems(selected.map((item) => item.id));
    const prepared = await prepareSelectedNotes(selected, format, options);
    return await writeNoteExport(prepared.notes, prepared.plan, parent, {
      ...options,
      strictAssets: true,
      verifySources: async () => {
        for (const note of prepared.notes) {
          const item = selected.find(
            (item) =>
              item.libraryID === note.libraryID && item.key === note.key,
          )!;
          if (
            (await item.getFilePathAsync()) !== note.path ||
            (await Zotero.File.getContentsAsync(note.path!)) !== note.content
          )
            throw new Error(
              "The Markdown source changed during export. Please retry.",
            );
          assertUnchangedStamp(
            { size: note.fileSize, lastModified: note.fileModified },
            await IOUtils.stat(note.path!),
          );
        }
      },
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return null;
    throw error;
  }
}

async function writeNoteExport(
  notes: readonly NoteDocument[],
  plan: NoteExportPlan,
  parent: string,
  options: SelectedNoteExportOptions & {
    strictAssets?: boolean;
    verifySources?: () => Promise<void>;
  } = {},
): Promise<{ directory: string; notes: number; warnings: string[] }> {
  assertTransferContinues(options.shouldContinue);
  const assetWarning = plan.warnings.find((message) =>
    /^Unable to (?:export|rewrite) asset /.test(message),
  );
  if (options.strictAssets && assetWarning) throw new Error(assetWarning);
  const directory = await createExportDirectory(parent);
  const warnings = [...plan.warnings];
  const copiedAssets: Array<{
    source: string;
    stamp: { size?: number; lastModified?: number };
  }> = [];
  try {
    for (const file of plan.files) {
      assertTransferContinues(options.shouldContinue);
      await Zotero.File.putContentsAsync(
        PathUtils.join(directory, file.path),
        file.content,
      );
    }

    const noteByKey = new Map(
      notes.map((note) => [`${note.libraryID}:${note.key}`, note] as const),
    );
    for (const asset of plan.assets) {
      assertTransferContinues(options.shouldContinue);
      const note = noteByKey.get(`${asset.libraryID}:${asset.key}`);
      const source = note ? sourceAssetPath(note, asset.reference) : null;
      if (!source) {
        if (options.strictAssets)
          throw new Error(`Invalid local image path: ${asset.reference}`);
        warnings.push(
          `Unable to copy asset ${asset.reference}: invalid source root`,
        );
        continue;
      }
      try {
        const before = await assertRegularImageFile(source);
        const bytes = await IOUtils.read(source);
        const after = await assertRegularImageFile(source);
        assertUnchangedStamp(before, after);
        // Export paths use URL separators; Gecko appends each join argument
        // as one native filename and rejects a nested path as that argument.
        const target = PathUtils.join(directory, ...asset.path.split("/"));
        const targetDirectory = PathUtils.parent(target);
        if (!targetDirectory) throw new Error("Invalid export target");
        await IOUtils.makeDirectory(targetDirectory, {
          ignoreExisting: true,
          createAncestors: true,
        });
        await IOUtils.write(target, bytes);
        copiedAssets.push({ source, stamp: after });
      } catch (error) {
        if (options.strictAssets) throw error;
        warnings.push(
          `Unable to copy asset ${asset.reference}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    assertTransferContinues(options.shouldContinue);
    if (options.strictAssets) {
      await options.verifySources?.();
      for (const asset of copiedAssets)
        assertUnchangedStamp(
          asset.stamp,
          await assertRegularImageFile(asset.source),
        );
    }
    if (warnings.length) {
      const report = warningReportPath(plan.files);
      await Zotero.File.putContentsAsync(
        PathUtils.join(directory, report),
        `# Export warnings\n\n${warnings.map((message) => `- ${message}`).join("\n")}\n`,
      );
    }
    return { directory, notes: plan.files.length, warnings };
  } catch (error) {
    await IOUtils.remove(directory, { recursive: true });
    throw error;
  }
}
