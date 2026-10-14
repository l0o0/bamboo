import { getString } from "../../utils/locale";
import {
  markAttachmentForUpload,
  withAttachmentWrite,
} from "../attachment-sync";
import { isMarkdownFilename, markdownDocumentTitle } from "./detect";
import {
  assertRegularImageFile,
  assertTransferContinues,
  buildNoteExport,
  sourceAssetPath,
} from "./export-notes";
import { invalidateNoteLibrary } from "./note-library";
import {
  createMarkdownImportPaths,
  normalizeMarkdownFilename,
} from "./storage-filename";
import { mimeFromAssetPath, validateImageInput } from "./images/model";

export interface MarkdownImportTarget {
  parent?: Zotero.Item | null;
  libraryID: number;
  collectionID?: number | null;
}

/** Recheck the captured destination, rather than consulting a later selection. */
export function assertMarkdownImportTarget(target: MarkdownImportTarget): void {
  const library = Zotero.Libraries.get(target.libraryID);
  if (!library || !library.editable || !library.filesEditable)
    throw new Error("The selected library is read-only");
  if (
    target.parent &&
    (!target.parent.isRegularItem() ||
      target.parent.deleted ||
      target.parent.libraryID !== target.libraryID ||
      !target.parent.isEditable())
  )
    throw new Error("The selected parent item is unavailable or read-only");
  if (!target.parent && target.collectionID != null) {
    const collection = Zotero.Collections.get(target.collectionID);
    if (
      !collection ||
      collection.deleted ||
      collection.libraryID !== target.libraryID
    )
      throw new Error("The selected collection is unavailable");
  }
}

/** Import one Markdown file and only its referenced local images as a stored package. */
export async function importMarkdownFile(
  win: Window,
  target: MarkdownImportTarget,
  options: { sourcePath?: string; shouldContinue?: () => boolean } = {},
): Promise<Zotero.Item | null> {
  assertMarkdownImportTarget(target);
  const sourcePath =
    options.sourcePath ??
    (await new ztoolkit.FilePicker(
      getString("toolbar-import-markdown"),
      "open",
      [["Markdown", "*.md;*.markdown;*.mdown;*.mkd;*.mkdn"]],
      undefined,
      win,
    ).open());
  if (!sourcePath || options.shouldContinue?.() === false) return null;
  if (
    !isMarkdownFilename(sourcePath) ||
    !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(sourcePath) ||
    sourcePath.includes("\0")
  )
    throw new Error("Choose a local Markdown file");
  const filename = normalizeMarkdownFilename(
    PathUtils.filename(sourcePath).replace(
      /\.(?:markdown|mdown|mkd|mkdn)$/i,
      ".md",
    ),
  );
  const raw = await Zotero.File.getContentsAsync(sourcePath);
  if (typeof raw !== "string")
    throw new Error("The Markdown file could not be read");
  const note = {
    libraryID: target.libraryID,
    key: "IMPORTED",
    filename,
    title: markdownDocumentTitle(filename),
    content: raw,
    path: sourcePath,
  };
  const planOptions = {
    format: "wiki",
    rewriteNoteLinks: false,
    wikiImageBase: "sibling",
  } as const;
  const initialPlan = buildNoteExport([note], planOptions);
  if (initialPlan.warnings.length)
    throw new Error(initialPlan.warnings.join("\n"));
  // Editor assets deliberately accept only one filename within assets/.
  // Flatten imported references without allowing case-insensitive collisions.
  const assetPaths = new Map<string, string>();
  const occupied = new Set<string>();
  for (const asset of initialPlan.assets) {
    const original = asset.reference
      .split("/")
      .at(-1)!
      .replace(/[\\:*?"<>|#%[\]\0]/g, "-");
    const dot = original.lastIndexOf(".");
    let path = `assets/${original}`;
    for (let suffix = 2; occupied.has(path.toLocaleLowerCase()); suffix++)
      path = `assets/${original.slice(0, dot)}-${suffix}${original.slice(dot)}`;
    occupied.add(path.toLocaleLowerCase());
    assetPaths.set(`${asset.libraryID}:${asset.key}:${asset.reference}`, path);
  }
  const plan = buildNoteExport([note], { ...planOptions, assetPaths });
  if (plan.warnings.length) throw new Error(plan.warnings.join("\n"));
  const staged = createMarkdownImportPaths(
    Zotero.getTempDirectory().path,
    filename,
  );
  let ownsStaging = false;
  let attachment: Zotero.Item | undefined;
  try {
    assertTransferContinues(options.shouldContinue);
    await IOUtils.makeDirectory(staged.directory, { ignoreExisting: false });
    ownsStaging = true;
    for (const asset of plan.assets) {
      assertTransferContinues(options.shouldContinue);
      const source = sourceAssetPath(note, asset.reference);
      if (!source)
        throw new Error(`Invalid local image path: ${asset.reference}`);
      const info = await assertRegularImageFile(source);
      const mime = mimeFromAssetPath(asset.path);
      if (!mime)
        throw new Error(`Unsupported local image format: ${asset.reference}`);
      if (typeof info.size === "number") validateImageInput(mime, info.size);
      const destination = PathUtils.join(
        staged.directory,
        ...asset.path.split("/"),
      );
      const destinationParent = PathUtils.parent(destination);
      if (!destinationParent) throw new Error("Invalid image destination");
      await IOUtils.makeDirectory(destinationParent, {
        ignoreExisting: true,
        createAncestors: true,
      });
      const bytes = await IOUtils.read(source);
      validateImageInput(mime, bytes.byteLength);
      await IOUtils.write(destination, bytes);
    }
    await Zotero.File.putContentsAsync(staged.file, plan.files[0].content);
    assertTransferContinues(options.shouldContinue);
    assertMarkdownImportTarget(target);
    // Native snapshot import commits the complete staged directory in its DB
    // transaction. The library never exposes a Markdown file without its images.
    const importSnapshot = Zotero.Attachments.importSnapshotFromFile;
    if (typeof importSnapshot !== "function")
      throw new Error("This Zotero host cannot import Markdown image packages");
    attachment = await importSnapshot.call(Zotero.Attachments, {
      file: staged.file,
      title: filename,
      contentType: "text/markdown",
      charset: "utf-8",
      parentItemID: target.parent?.id,
      libraryID: target.parent ? undefined : target.libraryID,
      singleFile: false,
      saveOptions: { skipSelect: true },
    });
    if (!attachment?.id)
      throw new Error("Markdown import returned no attachment");
    const created = attachment;
    await withAttachmentWrite(created, async () => {
      assertTransferContinues(options.shouldContinue);
      assertMarkdownImportTarget(target);
      created.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
      if (!target.parent && target.collectionID != null)
        created.setCollections([target.collectionID]);
      await created.saveTx({ skipSelect: true });
      await markAttachmentForUpload(created, { packageChanged: true });
    });
    assertTransferContinues(options.shouldContinue);
    await IOUtils.remove(staged.directory, { recursive: true });
    ownsStaging = false;
    invalidateNoteLibrary(created.libraryID);
    return created;
  } catch (error) {
    if (attachment) {
      try {
        await attachment.eraseTx();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Markdown import and cleanup failed",
          { cause: cleanupError },
        );
      }
    }
    if ((error as Error)?.name === "AbortError") return null;
    throw error;
  } finally {
    if (ownsStaging && (await IOUtils.exists(staged.directory)))
      await IOUtils.remove(staged.directory, { recursive: true });
  }
}
