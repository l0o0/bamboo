import {
  ACADEMIC_SOURCE_CARD_SIZE,
  createAcademicNode,
  emptyCanvasDocument,
  type CanvasDocument,
} from "./snapshot";
import { serializeCanvasDocument } from "../../../packages/whiteboard/src/model/canvas-file";
import { defaultCanvasFilename } from "./detect";
import { createZoteroSourceGateway } from "./source-gateway";
import {
  getSelectedCollections,
  getSelectedLibraryIDs,
} from "../../compat/zotero-pane";

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(
      key.slice(hexadecimal ? 2 : 1),
      hexadecimal ? 16 : 10,
    );
    const isUnicodeScalar =
      codePoint > 0 &&
      codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return isUnicodeScalar ? String.fromCodePoint(codePoint) : entity;
  });
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function htmlTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function stripHtmlMarkup(value: string): string {
  let text = "";
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("<!--", index)) {
      const commentEnd = value.indexOf("-->", index + 4);
      index = commentEnd < 0 ? value.length : commentEnd + 3;
      continue;
    }
    if (value[index] !== "<") {
      text += value[index];
      index += 1;
      continue;
    }

    const end = htmlTagEnd(value, index + 1);
    if (end < 0) {
      text += value[index];
      index += 1;
      continue;
    }
    const token = value.slice(index + 1, end);
    const tag = /^\s*\/?\s*([a-z][\w:-]*)\b/i.exec(token)?.[1];
    const isDeclaration = /^\s*[!?]/.test(token);
    if (!tag && !isDeclaration) {
      text += value.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const isClosingTag = /^\s*\//.test(token);
    if (
      tag &&
      BLOCK_TAGS.has(tag.toLowerCase()) &&
      (isClosingTag || tag.toLowerCase() === "br" || tag.toLowerCase() === "hr")
    ) {
      text += "\n";
    }
    index = end + 1;
  }
  return text;
}

export function zoteroNotePlainText(item: { getNote?: () => unknown }): string {
  try {
    const html = item.getNote?.();
    if (typeof html === "string") {
      return decodeHtmlEntities(stripHtmlMarkup(html))
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/ *\r?\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  } catch {
    // ignore
  }
  return "";
}

export interface CreateWhiteboardAttachmentOptions {
  document?: CanvasDocument;
  libraryID?: number;
  collections?: number[];
  filename?: string;
  select?: boolean;
  reportError?: boolean;
  win?: _ZoteroTypes.MainWindow;
}

function validLibraryID(id: number): boolean {
  return (
    Number.isInteger(id) &&
    id > 0 &&
    typeof Zotero.Libraries.get === "function" &&
    !!Zotero.Libraries.get(id)
  );
}

function collectionInLibrary(id: number, libraryID: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  if (typeof Zotero.Collections?.get !== "function") return false;
  const collection = Zotero.Collections.get(id);
  return (
    !!collection && !collection.deleted && collection.libraryID === libraryID
  );
}

export async function createWhiteboardAttachment(
  parentItem?: Zotero.Item | null,
  options: CreateWhiteboardAttachmentOptions = {},
): Promise<Zotero.Item | null> {
  let parent: Zotero.Item | undefined;
  let candidate = parentItem;
  while (candidate && !candidate.isRegularItem())
    candidate = candidate.parentItem || undefined;
  if (candidate?.isRegularItem()) parent = candidate;

  const filename = Zotero.File.getValidFileName(
    options.filename ?? defaultCanvasFilename(),
  );
  const content = serializeCanvasDocument(
    options.document ?? emptyCanvasDocument(),
  );

  const tmpDir = PathUtils.join(
    Zotero.getTempDirectory().path,
    `bamboo-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const tmpPath = PathUtils.join(tmpDir, filename);
  try {
    // Capture selection before filesystem work can change the active window.
    const pane = options.win?.ZoteroPane ?? Zotero.getActiveZoteroPane();
    const libraryID =
      parent?.libraryID ??
      options.libraryID ??
      getSelectedLibraryIDs(pane).find(validLibraryID) ??
      Zotero.Libraries.userLibraryID;
    if (!validLibraryID(libraryID))
      throw new Error("Invalid whiteboard library");
    const selectedCollection = !parent
      ? getSelectedCollections(pane, true).find((id) =>
          collectionInLibrary(id, libraryID),
        )
      : undefined;
    const collections = parent
      ? undefined
      : options.collections !== undefined
        ? [...new Set(options.collections)].filter((id) =>
            collectionInLibrary(id, libraryID),
          )
        : selectedCollection !== undefined
          ? [selectedCollection]
          : undefined;

    await IOUtils.makeDirectory(tmpDir, { ignoreExisting: false });
    await Zotero.File.putContentsAsync(tmpPath, content);

    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpPath,
      fileBaseName: filename.replace(/\.canvas$/i, ""),
      parentItemID: parent?.id,
      libraryID: parent ? undefined : libraryID,
      collections,
      title: filename,
      contentType: "application/json",
      charset: "utf-8",
    });

    if (!attachment?.id) {
      throw new Error("importFromFile returned no attachment item");
    }
    if (attachment.attachmentContentType !== "application/json") {
      attachment.attachmentContentType = "application/json";
      await attachment.saveTx({ skipSelect: true });
    }

    try {
      if (options.select !== false && pane?.selectItem) {
        await pane.selectItem(attachment.id);
      }
    } catch (error) {
      ztoolkit.log("selectItem after create whiteboard failed", error);
    }

    return attachment;
  } catch (error) {
    ztoolkit.log("createWhiteboardAttachment failed", error);
    if (options.reportError !== false) {
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `Create failed: ${error instanceof Error ? error.message : String(error)}`,
          type: "fail",
        })
        .show();
    }
    return null;
  } finally {
    try {
      await IOUtils.remove(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  }
}

export async function createWhiteboardForSelection(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems?.() || [];
  let parent: Zotero.Item | null = null;
  for (const item of selected) {
    if (item.isRegularItem()) {
      parent = item;
      break;
    }
    if (item.isAttachment() || item.isNote()) {
      parent = item.parentItem || null;
      if (parent) break;
    }
  }
  const attachment = await createWhiteboardAttachment(parent);
  if (attachment) {
    const { openWhiteboardAttachment } = await import("./open");
    await openWhiteboardAttachment(attachment);
  }
}

export function buildCollectionCanvas(
  collection: Zotero.Collection,
): CanvasDocument {
  const document = emptyCanvasDocument();
  const gateway = createZoteroSourceGateway();
  const items = collection.getChildItems();
  let y = 80;
  let seq = 0;
  for (const item of items) {
    if (!item.isRegularItem() || item.parentItem) continue;
    if (seq >= 50) break;
    const itemId = `col-item-${seq}`;
    const acquisition = gateway.acquireItem(item);
    if (acquisition.kind !== "literature") continue;
    document.nodes.push(
      createAcademicNode("literature", { x: 80, y }, itemId, {
        source: acquisition.source,
        snapshot: acquisition.snapshot,
      }),
    );

    const note = item
      .getNotes()
      .map((id) => Zotero.Items.get(id))
      .find((child): child is Zotero.Item => !!child && child.isNote?.());
    if (note) {
      const acquisition = gateway.acquireItem(note);
      if (acquisition.kind !== "note") continue;
      const noteId = `${itemId}-note`;
      const noteNode = createAcademicNode(
        "note",
        {
          x: 80,
          y: y + ACADEMIC_SOURCE_CARD_SIZE.literature.height + 40,
        },
        noteId,
      );
      document.nodes.push({
        ...noteNode,
        source: acquisition.source,
        ...(acquisition.sourceSnapshot
          ? { sourceSnapshot: acquisition.sourceSnapshot }
          : {}),
        content: acquisition.content,
      });
      document.connections.push({
        id: `${itemId}-e-note`,
        kind: "basic",
        source: itemId,
        target: noteId,
      });
    }

    y += 440;
    seq += 1;
  }
  return document;
}

export async function createWhiteboardFromCollection(
  options: {
    win?: _ZoteroTypes.MainWindow;
    shouldOpen?: () => boolean;
  } = {},
): Promise<void> {
  const canOpen = () =>
    !options.win?.closed && options.shouldOpen?.() !== false;
  if (!canOpen()) return;
  const pane = options.win?.ZoteroPane ?? Zotero.getActiveZoteroPane();
  const libraryID =
    getSelectedLibraryIDs(pane).find(validLibraryID) ??
    Zotero.Libraries.userLibraryID;
  const collectionID = getSelectedCollections(pane, true).find((id) =>
    collectionInLibrary(id, libraryID),
  );
  if (!collectionID) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Select a collection first", type: "fail" })
      .show();
    return;
  }
  const collection = Zotero.Collections.get(collectionID);
  if (!collection || collection.deleted) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Collection not found", type: "fail" })
      .show();
    return;
  }
  const library = Zotero.Libraries.get(collection.libraryID);
  if (
    !library ||
    !library.editable ||
    !library.filesEditable ||
    (typeof pane?.canEdit === "function" && !pane.canEdit())
  )
    return;
  const document = buildCollectionCanvas(collection);
  const attachment = await createWhiteboardAttachment(null, {
    document,
    libraryID: collection.libraryID,
    collections: [collection.id],
    win: options.win,
    select: false,
  });
  if (!attachment || !canOpen()) return;
  try {
    await pane?.selectItem?.(attachment.id);
  } catch (error) {
    ztoolkit.log("selectItem after collection whiteboard failed", error);
  }
  if (!canOpen()) return;
  const [{ openWhiteboardTab }, { rememberWhiteboard }] = await Promise.all([
    import("./tab"),
    import("./open"),
  ]);
  if (!canOpen()) return;
  const tabID = await openWhiteboardTab(attachment, options);
  if (tabID && canOpen()) rememberWhiteboard(attachment.id);
}
