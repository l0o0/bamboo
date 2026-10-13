import { getPref } from "../../utils/prefs";
import { normalizeColorScheme } from "../../../packages/whiteboard/src/model/colorSchemes";
import {
  normalizeBackgroundColor,
  normalizeFontFamily,
} from "../markdown/preferences";
import { rememberDocument, forgetOpenDocument } from "../workspace-state";
import { navigateDocumentLink } from "../markdown/document-links";
import { resolveEditorTheme } from "../markdown/editor";
import { getString } from "../../utils/locale";
import { ensureDOMGlobals } from "../../utils/dom";
import {
  createWhiteboardEditor,
  type NativeAcademicDropResolution,
} from "./editor";
import { readCanvasFile } from "./file-io";
import { persistCanvasAttachment } from "./persist";
import {
  parseCanvasDocument,
  type CanvasDocument,
  type LiteratureSource,
  type NoteSource,
} from "./snapshot";
import {
  whiteboardChannel,
  type AcademicAcquisition,
  type AcademicAcquisitionBatch,
  type AcademicAcquisitionFailure,
  type AcademicDropFailureCode,
  type AcademicDropSourceRef,
  type AcademicRequestFailureCode,
  type AcademicSourceDescriptor,
  type AnnotationListFailure,
} from "./protocol";
import { WhiteboardSaveCoordinator } from "./save-coordinator";
import { bindWhiteboardSourceVisibility } from "./source-visibility";
import { captureWhiteboardSurfaceTransfer } from "./surface-transfer";
import { whiteboardRegistry, type WhiteboardSession } from "./session-registry";
import { WHITEBOARD_TAB_TYPE } from "./tabHooks";
import { isWhiteboardAttachment } from "./detect";
import {
  createZoteroSourceGateway,
  SourceGatewayError,
  type ZoteroSourceGateway,
} from "./source-gateway";
import { ProgressiveSourceScheduler } from "./source-scheduler";
import { sourceCacheKey } from "../../../packages/whiteboard/src/whiteboard/sourceState";
import { getZoteroNoteTemplateRepository } from "./template-repository";
import {
  decodeEmbeddedFileData,
  embeddedFileNodeRaw,
  MAX_ATTACHMENT_BYTES,
  requiresExplicitSave,
  safeEmbeddedFilename,
} from "./embedded-file";

import { injectWhiteboardStyles } from "./styles";

const AUTOSAVE_MS = 800;

export function applyWhiteboardSettings() {
  const colorScheme = normalizeColorScheme(getPref("whiteboardColorScheme"));
  const appearance = {
    fontFamily: normalizeFontFamily(getPref("whiteboardFontFamily")),
    backgroundColor: normalizeBackgroundColor(
      getPref("whiteboardBackgroundColor"),
    ),
  };
  for (const session of whiteboardRegistry.all()) {
    session.editor?.setColorScheme(colorScheme);
    session.editor?.setAppearance(appearance);
    session.editor?.setTheme(resolveEditorTheme(session.win));
  }
}

function logAcademicDiagnostic(message: string, detail: object) {
  if (typeof ztoolkit !== "undefined") ztoolkit.log(message, detail);
}

export type AcademicRequestFailureDiagnostic = {
  operation: "picker" | "drop";
  requestId: string;
  nodeId?: string;
  index?: number;
  code:
    | AcademicRequestFailureCode
    | AcademicDropFailureCode
    | AcademicAcquisitionFailure["code"];
  diagnostic?: string;
};

export function reportAcademicRequestFailure(
  detail: AcademicRequestFailureDiagnostic,
  log: (message: string, detail: object) => void = logAcademicDiagnostic,
) {
  const operation = detail.operation === "picker" ? "picker" : "drop";
  log(`Academic source ${operation} failed`, detail);
}

function newCanvasId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `wb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function isDirty(session: WhiteboardSession) {
  return session.saveCoordinator?.dirty ?? false;
}

function applyShellTheme(root: HTMLElement | undefined, dark: boolean) {
  if (!root) return;
  root.classList.toggle("theme-dark", dark);
  root.classList.toggle("theme-light", !dark);
}

function bindSessionTheme(win: Window, session: WhiteboardSession) {
  session.unbindTheme?.();
  const sync = () => {
    const theme = resolveEditorTheme(win);
    applyShellTheme(session.view?.root, theme === "dark");
    session.editor?.setTheme(theme);
  };
  let mql: MediaQueryList | null = null;
  const onMql = () => sync();
  try {
    mql = win.matchMedia?.("(prefers-color-scheme: dark)") || null;
    mql?.addEventListener?.("change", onMql);
  } catch {
    // ignore
  }
  session.unbindTheme = () => {
    try {
      mql?.removeEventListener?.("change", onMql);
    } catch {
      // ignore
    }
  };
  sync();
}

function attachmentTitle(item: Zotero.Item) {
  return (
    item.attachmentFilename ||
    item.getField("title") ||
    getString("whiteboard-tab-title")
  );
}

function refreshTabTitle(session: WhiteboardSession) {
  if (session.surface === "sidebar") return;
  const dirty = isDirty(session) ? " *" : "";
  if (session.surface === "window") {
    const title = `${session.title}${dirty} · Scholar Sketch`;
    if (session.win.document.title !== title)
      session.win.document.title = title;
    return;
  }
  const tabs = (session.win as _ZoteroTypes.MainWindow).Zotero_Tabs;
  const { tab } = tabs._getTab(session.tabID) || {};
  const title = `${session.title}${dirty}`;
  if (!tab || tab.title === title) return;
  tab.title = title;
  try {
    (tabs as any)._update?.();
  } catch {
    // ignore
  }
}

function toast(message: string, type: "success" | "fail" = "fail") {
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text: message, type })
    .show();
}

function pickZoteroItem(
  win: Window,
  opts: { onlyRegularItems?: boolean } = {},
): number[] | null {
  const Services = ztoolkit.getGlobal("Services") as {
    ww: {
      openWindow: (
        parent: Window | null,
        url: string,
        name: string,
        features: string,
        args: unknown,
      ) => void;
    };
  };
  const io: {
    dataOut?: number[] | null;
    singleSelection: boolean;
    onlyRegularItems?: boolean;
    multiSelect: boolean;
  } = {
    dataOut: null,
    singleSelection: false,
    onlyRegularItems: opts.onlyRegularItems ?? false,
    multiSelect: true,
  };
  Services.ww.openWindow(
    null,
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,modal,centerscreen,resizable=yes",
    io,
  );
  return io.dataOut?.length ? io.dataOut : null;
}

type AcademicItemGateway = {
  acquireItem(
    item: Zotero.Item,
  ): AcademicAcquisition | Promise<AcademicAcquisition>;
};

export async function acquireAcademicItems(
  items: readonly (Zotero.Item | undefined)[],
  gateway: AcademicItemGateway,
): Promise<AcademicAcquisitionBatch> {
  const outcomes = await Promise.all(
    items.map(async (item, index) => {
      if (!item) {
        return {
          failure: {
            index,
            code: "item-missing",
            message: "Zotero item not found.",
          } satisfies AcademicAcquisitionFailure,
        };
      }
      try {
        if (
          item.isRegularItem?.() ||
          item.isNote?.() ||
          item.isAttachment?.()
        ) {
          return {
            success: { index, acquisition: await gateway.acquireItem(item) },
          };
        }
        return {
          failure: {
            index,
            code: "unsupported-kind",
            message: "This Zotero item type cannot be added to the canvas.",
          } satisfies AcademicAcquisitionFailure,
        };
      } catch (error) {
        return {
          failure: {
            index,
            code: "acquisition-failed",
            message: error instanceof Error ? error.message : String(error),
          } satisfies AcademicAcquisitionFailure,
        };
      }
    }),
  );
  return {
    successes: outcomes.flatMap((outcome) =>
      "success" in outcome && outcome.success ? [outcome.success] : [],
    ),
    failures: outcomes.flatMap((outcome) =>
      "failure" in outcome && outcome.failure ? [outcome.failure] : [],
    ),
  };
}

async function resolveAcademicItems(
  session: WhiteboardSession,
  requestId: string,
  nodeId: string,
  itemIDs: readonly number[],
) {
  const editor = session.editor;
  if (!editor) return;
  const gateway = createZoteroSourceGateway();
  const items = itemIDs.map((itemID) => {
    try {
      return Zotero.Items.get(itemID) || undefined;
    } catch {
      return undefined;
    }
  });
  const result = await acquireAcademicItems(items, gateway);
  for (const failure of result.failures) {
    ztoolkit.log("Academic source acquisition failed", {
      index: failure.index,
      code: failure.code,
      message: failure.message,
    });
  }
  editor.resolveAcademicAcquisitionBatch(
    requestId,
    nodeId,
    result.successes,
    result.failures,
  );
}

export function dataUrlToBytes(
  dataUrl: string,
): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]+)?(?:;[^;,=]+=[^;,]*)*(;base64)?,(.*)$/s.exec(
    dataUrl,
  );
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const payload = match[3];
  let bytes: Uint8Array;
  if (match[2]) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return { bytes, mimeType };
}

async function handlePickAcademicSource(
  session: WhiteboardSession,
  requestId: string,
  nodeId: string,
  kind: "literature",
) {
  const editor = session.editor;
  if (!editor) return;
  try {
    const itemIDs = pickZoteroItem(session.win);
    if (!itemIDs) {
      editor.rejectAcademicRequest(requestId, nodeId, "picker-cancelled");
      return;
    }
    if (kind !== "literature") {
      throw new Error("Select a regular Zotero item or Note");
    }
    await resolveAcademicItems(session, requestId, nodeId, itemIDs);
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    reportAcademicRequestFailure({
      operation: "picker",
      requestId,
      nodeId,
      code: "picker-failed",
      diagnostic,
    });
    editor.rejectAcademicRequest(
      requestId,
      nodeId,
      "picker-failed",
      diagnostic,
    );
  }
}

function openZoteroItem(payload: {
  itemID?: number;
  attachmentID?: number;
  pdfPage?: number;
}) {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return;
  if (payload.attachmentID) {
    const attachment = Zotero.Items.get(payload.attachmentID);
    if (attachment) {
      if (payload.pdfPage) {
        try {
          const reader = (Zotero as any).Reader;
          if (reader?.open) {
            void reader.open(attachment.id, { pageIndex: payload.pdfPage });
            return;
          }
        } catch {
          // fall back to the default file handler
        }
      }
      void Zotero.FileHandlers.open(attachment);
      return;
    }
    pane.selectItem(payload.attachmentID);
    return;
  }
  if (payload.itemID) {
    pane.selectItem(payload.itemID);
  }
}

function embeddedFilePath(data: {
  title: string;
  contentType: string;
}): string {
  const token = (() => {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  })();
  return PathUtils.join(
    Zotero.getTempDirectory().path,
    "bamboo-whiteboard-embedded",
    `${token}-${safeEmbeddedFilename(data.title, data.contentType, {
      forOpen: true,
    })}`,
  );
}

async function openEmbeddedFile(
  session: WhiteboardSession,
  nodeId: string,
  attachmentId?: string,
) {
  if (session.transitioning || session.closing) return;
  const editor = session.editor;
  if (!editor) throw new Error(getString("whiteboard-file-unavailable"));
  const shot = await editor.requestSnapshot();
  // The snapshot is asynchronous; discard it if this surface was replaced or closed.
  if (session.editor !== editor || session.transitioning || session.closing)
    return;
  const raw = embeddedFileNodeRaw(shot.snapshot, nodeId, attachmentId);
  if (
    raw &&
    typeof raw === "object" &&
    Number.isSafeInteger((raw as { size?: unknown }).size) &&
    ((raw as { size: number }).size > MAX_ATTACHMENT_BYTES ||
      (raw as { size: number }).size < 0)
  ) {
    throw new Error(getString("whiteboard-file-too-large"));
  }
  const data = decodeEmbeddedFileData(raw);
  if (!data) throw new Error(getString("whiteboard-file-unavailable"));

  if (requiresExplicitSave(data.title, data.contentType)) {
    const filename = safeEmbeddedFilename(data.title, data.contentType);
    const picked = await new ztoolkit.FilePicker(
      getString("whiteboard-file-open"),
      "save",
      [[getString("whiteboard-file-generic"), "*.*"]],
      filename,
      session.win,
    ).open();
    if (
      !picked ||
      session.editor !== editor ||
      session.transitioning ||
      session.closing
    )
      return;
    await IOUtils.write(picked, data.bytes);
    toast(getString("whiteboard-file-open"), "success");
    return;
  }

  const path = embeddedFilePath(data);
  const directory = PathUtils.parent(path);
  if (!directory) throw new Error(getString("whiteboard-file-unavailable"));
  await IOUtils.makeDirectory(directory, {
    ignoreExisting: true,
    createAncestors: true,
  });
  await IOUtils.write(path, data.bytes);
  if (session.editor !== editor || session.transitioning || session.closing)
    return;
  const launchFile = (
    Zotero as unknown as {
      launchFile?: (filePath: string) => unknown;
    }
  ).launchFile;
  if (typeof launchFile !== "function") {
    throw new Error(getString("whiteboard-file-unavailable"));
  }
  await launchFile(path);
}

type ZoteroDragTransfer = Pick<DataTransfer, "types" | "getData">;

const ZOTERO_DRAG_PRECEDENCE = [
  "zotero/collection",
  "zotero/item",
  "zotero/search",
] as const;

function primaryZoteroDragType(transfer: ZoteroDragTransfer) {
  const types = Array.from(transfer.types ?? []);
  return ZOTERO_DRAG_PRECEDENCE.find((type) => types.includes(type));
}

export function parseDroppedItemIDs(transfer: ZoteroDragTransfer): number[] {
  return readDroppedItemIDs(transfer).itemIDs;
}

function readDroppedItemIDs(transfer: ZoteroDragTransfer): {
  itemIDs: number[];
  diagnostic?: string;
} {
  if (primaryZoteroDragType(transfer) !== "zotero/item") {
    return { itemIDs: [] };
  }
  let payload: string;
  try {
    payload = transfer.getData("zotero/item").trim();
  } catch (error) {
    return {
      itemIDs: [],
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
  if (!payload || !/^\d+(?:\s*,\s*\d+)*$/.test(payload)) {
    return { itemIDs: [] };
  }
  const ids = payload.split(",").map((value) => Number(value.trim()));
  return {
    itemIDs: ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids : [],
  };
}

interface AcademicDropResolverDependencies {
  userLibraryID: number;
  getItem(itemID: number): Zotero.Item | null;
  getLibrary(
    libraryID: number,
  ): { libraryType: string; groupID?: number } | null;
}

export function resolveNativeAcademicDrop(
  transfer: ZoteroDragTransfer,
  dependencies: AcademicDropResolverDependencies = {
    userLibraryID: Zotero.Libraries.userLibraryID,
    getItem: (itemID) => Zotero.Items.get(itemID) || null,
    getLibrary: (libraryID) => Zotero.Libraries.get(libraryID) || null,
  },
): NativeAcademicDropResolution {
  const type = primaryZoteroDragType(transfer);
  if (!type) return { status: "ignored" };
  if (type !== "zotero/item") {
    return { status: "rejected", code: "drop-unsupported" };
  }
  const parsed = readDroppedItemIDs(transfer);
  const itemIDs = parsed.itemIDs;
  if (!itemIDs.length) {
    return {
      status: "rejected",
      code: "drop-malformed",
      ...(parsed.diagnostic ? { diagnostic: parsed.diagnostic } : {}),
    };
  }
  const sources: AcademicDropSourceRef[] = [];
  try {
    for (const itemID of itemIDs) {
      const item = dependencies.getItem(itemID);
      if (!item?.key) {
        return { status: "rejected", code: "drop-malformed" };
      }
      const library =
        item.libraryID === dependencies.userLibraryID
          ? ({ type: "user" } as const)
          : (() => {
              const value = dependencies.getLibrary(item.libraryID);
              if (
                value?.libraryType !== "group" ||
                typeof value.groupID !== "number"
              ) {
                return null;
              }
              return { type: "group", groupID: value.groupID } as const;
            })();
      if (!library) {
        return { status: "rejected", code: "drop-unsupported" };
      }
      const isAttachment = item.isAttachment?.() ?? false;
      const isRegular = item.isRegularItem?.() ?? !isAttachment;
      if (isAttachment) {
        sources.push({ library, attachmentKey: item.key });
        continue;
      }
      if (isRegular) sources.push({ library, itemKey: item.key });
      else return { status: "rejected", code: "drop-unsupported" };
    }
  } catch (error) {
    return {
      status: "rejected",
      code: "drop-malformed",
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
  return { status: "accepted", sources };
}

async function handleDropAcademicSources(
  session: WhiteboardSession,
  requestId: string,
  nodeId: string,
  sources: readonly AcademicDropSourceRef[],
) {
  const editor = session.editor;
  if (!editor) return;
  try {
    if (!sources.length) {
      reportAcademicRequestFailure({
        operation: "drop",
        requestId,
        nodeId,
        code: "acquisition-failed",
        diagnostic: "The native source list was empty.",
      });
      editor.rejectAcademicRequest(requestId, nodeId, "acquisition-failed");
      return;
    }
    const items = sources.map((source) => {
      const key =
        "attachmentKey" in source ? source.attachmentKey : source.itemKey;
      const libraryID =
        source.library.type === "user"
          ? Zotero.Libraries.userLibraryID
          : (Zotero.Groups.get(source.library.groupID)?.libraryID ?? null);
      if (libraryID === null) return undefined;
      return Zotero.Items.getByLibraryAndKey(libraryID, key) || undefined;
    });
    const gateway = createZoteroSourceGateway();
    const result = await acquireAcademicItems(items, gateway);
    for (const failure of result.failures) {
      reportAcademicRequestFailure({
        operation: "drop",
        requestId,
        nodeId,
        index: failure.index,
        code: failure.code,
        diagnostic: failure.message,
      });
    }
    editor.resolveAcademicAcquisitionBatch(
      requestId,
      nodeId,
      result.successes,
      result.failures,
    );
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    reportAcademicRequestFailure({
      operation: "drop",
      requestId,
      nodeId,
      code: "acquisition-failed",
      diagnostic,
    });
    editor.rejectAcademicRequest(
      requestId,
      nodeId,
      "acquisition-failed",
      diagnostic,
    );
  }
}

async function handleRefreshZoteroNote(
  session: WhiteboardSession,
  requestId: string,
  nodeId: string,
  source: NoteSource,
) {
  const editor = session.editor;
  if (!editor) return;
  try {
    const gateway = createZoteroSourceGateway();
    const acquisition = await gateway.refreshNote(source);
    editor.applyNoteRefresh(requestId, nodeId, acquisition);
  } catch (error) {
    const code =
      error instanceof SourceGatewayError &&
      error.code !== "list-failed" &&
      error.code !== "open-failed"
        ? error.code
        : "note-refresh-failed";
    logAcademicDiagnostic("Zotero Note refresh failed", {
      nodeId,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    editor.rejectAcademicRequest(
      requestId,
      nodeId,
      code,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function handleListLiteratureAnnotations(
  session: WhiteboardSession,
  requestId: string,
  source: LiteratureSource,
  gateway: Pick<
    ZoteroSourceGateway,
    "listAnnotations"
  > = createZoteroSourceGateway(),
) {
  const editor = session.editor;
  if (!editor) return;
  try {
    const { candidates, failures } = await gateway.listAnnotations(source);
    for (const failure of failures) {
      logAcademicDiagnostic("Zotero annotation unavailable", {
        code: failure.code,
        attachmentKey: failure.attachmentKey,
        annotationKey: failure.annotationKey,
        message: failure.message,
      });
    }
    editor.applyAnnotationCandidates(requestId, source, candidates, failures);
  } catch (error) {
    const failure: AnnotationListFailure =
      error instanceof SourceGatewayError &&
      error.code !== "open-failed" &&
      error.code !== "note-refresh-failed"
        ? { code: error.code, message: error.message }
        : {
            code: "list-failed",
            message:
              error instanceof Error
                ? error.message
                : "Zotero annotations could not be loaded.",
          };
    logAcademicDiagnostic("Zotero annotation list failed", {
      code: failure.code,
      message: failure.message,
    });
    editor.rejectAnnotationList(requestId, source, failure);
  }
}

export async function handleOpenAcademicSource(
  session: WhiteboardSession,
  requestId: string,
  nodeId: string,
  source: AcademicSourceDescriptor,
  gateway: Pick<ZoteroSourceGateway, "open"> = createZoteroSourceGateway(),
) {
  try {
    await gateway.open(source);
    session.editor?.acceptSourceAction(requestId, nodeId, "open", source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof SourceGatewayError &&
      error.code !== "list-failed" &&
      error.code !== "note-refresh-failed"
        ? error.code
        : "open-failed";
    logAcademicDiagnostic("Academic source open failed", {
      nodeId,
      code,
      message,
    });
    session.editor?.rejectSourceAction(requestId, nodeId, source, {
      code,
      message,
    });
  }
}

async function handleExportFile(
  session: WhiteboardSession,
  payload: {
    requestId: string;
    format: "png" | "svg" | "md";
    mimeType: string;
    dataUrl?: string;
    text?: string;
  },
) {
  try {
    const extension =
      payload.format === "png"
        ? "png"
        : payload.format === "svg"
          ? "svg"
          : "md";
    const picked = await new ztoolkit.FilePicker(
      getString("whiteboard-export-title"),
      "save",
      [[`${payload.format.toUpperCase()} (*.${extension})`, `*.${extension}`]],
      Zotero.File.getValidFileName(
        `${session.title.replace(/\.canvas$/i, "") || "whiteboard"}.${extension}`,
      ),
      session.win,
    ).open();
    if (!picked) return;
    if (payload.dataUrl) {
      const parsed = dataUrlToBytes(payload.dataUrl);
      if (!parsed) throw new Error("Invalid image data");
      await IOUtils.write(picked, parsed.bytes);
    } else if (payload.text != null) {
      await Zotero.File.putContentsAsync(picked, payload.text);
    } else {
      throw new Error("Nothing to export");
    }
    toast(getString("whiteboard-exported"), "success");
  } catch (error) {
    toast(
      `${getString("whiteboard-export-failed")}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function scheduleAutosave(session: WhiteboardSession) {
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
  }
  session.autosaveTimer = session.win.setTimeout(() => {
    session.autosaveTimer = undefined;
    void saveSession(session, { silent: true });
  }, AUTOSAVE_MS);
}

async function saveSession(
  session: WhiteboardSession,
  opts: { silent?: boolean } = {},
): Promise<boolean> {
  const saveCoordinator = session.saveCoordinator;
  if (!saveCoordinator) return false;
  if (!isDirty(session) && opts.silent) return true;
  try {
    await saveCoordinator.request({ force: !opts.silent });
    if (!opts.silent) toast(getString("whiteboard-saved"), "success");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ztoolkit.log("Failed to save whiteboard", error);
    if (!opts.silent) {
      toast(`${getString("whiteboard-save-failed")}: ${message}`);
    }
    return false;
  }
}

function promptUnsaved(win: Window): "save" | "discard" {
  try {
    const Services = ztoolkit.getGlobal("Services") as {
      prompt: {
        BUTTON_POS_0: number;
        BUTTON_POS_1: number;
        BUTTON_TITLE_SAVE: number;
        BUTTON_TITLE_DONT_SAVE: number;
        confirmEx: (
          parent: Window,
          title: string,
          text: string,
          flags: number,
          b0: string | null,
          b1: string | null,
          b2: string | null,
          check: string | null,
          state: { value: boolean },
        ) => number;
      };
    };
    const flags =
      Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_SAVE +
      Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_DONT_SAVE;
    const result = Services.prompt.confirmEx(
      win,
      getString("whiteboard-unsaved-title"),
      getString("whiteboard-unsaved-prompt"),
      flags,
      null,
      null,
      null,
      null,
      { value: false },
    );
    return result === 0 ? "save" : "discard";
  } catch {
    return win.confirm(getString("whiteboard-unsaved-prompt"))
      ? "save"
      : "discard";
  }
}

function mountWhiteboardUI(
  win: Window,
  container: HTMLElement,
  session: WhiteboardSession,
  initialSnapshot: CanvasDocument,
) {
  const doc = container.ownerDocument;
  const root = doc.createElement("div");
  root.className = "zotero-whiteboard-root zotero-markdown-root";

  const host = doc.createElement("div");
  host.className = "zotero-whiteboard-host";

  root.appendChild(host);
  container.appendChild(root);

  session.view = { root, host };
  const gateway = createZoteroSourceGateway();
  const templateRepository = getZoteroNoteTemplateRepository(
    getString("whiteboard-template-conflict-copy"),
  );
  let resolutionBatchSequence = 0;
  session.sourceScheduler = new ProgressiveSourceScheduler({
    run: (job) => gateway.resolve(job.nodeId, job.generation, job.descriptor),
    emit: (results) => {
      for (const result of results) {
        if (result.status !== "unavailable") continue;
        ztoolkit.log("Academic source resolution failed", {
          nodeId: result.nodeId,
          code: result.code,
          message: result.message,
        });
      }
      const generations = new Map<number, typeof results>();
      for (const result of results) {
        const batch = generations.get(result.generation) ?? [];
        batch.push(result);
        generations.set(result.generation, batch);
      }
      for (const [generation, batch] of generations) {
        session.editor?.applySourceResolutionBatch(
          `source-result-${generation}-${resolutionBatchSequence++}`,
          generation,
          batch,
        );
      }
    },
  });
  session.unbindSourceVisibility = bindWhiteboardSourceVisibility(session);
  session.saveCoordinator = new WhiteboardSaveCoordinator({
    initialDocument: initialSnapshot,
    getSnapshot: async () => {
      if (!session.editor) throw new Error("Canvas editor is unavailable");
      await session.editor.ready;
      const shot = await session.editor.requestSnapshot();
      return {
        rev: shot.rev,
        document: parseCanvasDocument(shot.snapshot).document,
      };
    },
    write: async ({ document }) => {
      const item = Zotero.Items.get(session.itemID);
      if (!item || !isWhiteboardAttachment(item)) {
        throw new Error("Canvas attachment is gone");
      }
      if (!session.fileRevision) {
        throw new Error("Canvas file revision is unavailable");
      }
      session.path = await persistCanvasAttachment(item, document, {
        revision: session.fileRevision,
      });
      session.title = attachmentTitle(item);
    },
    onStateChange: (state) => {
      session.editor?.setSaveState(state);
      refreshTabTitle(session);
    },
  });
  session.editor = createWhiteboardEditor(host, {
    colorScheme: normalizeColorScheme(getPref("whiteboardColorScheme")),
    appearance: {
      fontFamily: normalizeFontFamily(getPref("whiteboardFontFamily")),
      backgroundColor: normalizeBackgroundColor(
        getPref("whiteboardBackgroundColor"),
      ),
    },
    win,
    channel: whiteboardChannel(session.tabID, session.canvasId),
    snapshot: initialSnapshot,
    templates: templateRepository.list(),
    labels: {
      settings: getString("more-settings"),
      switchWindow: getString(
        session.surface === "window" ? "more-open-tab" : "more-open-window",
      ),
      canvas: getString("whiteboard-canvas"),
      selection: getString("whiteboard-selection"),
      select: getString("whiteboard-select"),
      hand: getString("whiteboard-hand"),
      addItem: getString("whiteboard-add-item"),
      addNote: getString("whiteboard-add-note"),
      addQuestion: getString("whiteboard-add-question"),
      addClaim: getString("whiteboard-add-claim"),
      addEvidence: getString("whiteboard-add-evidence"),
      addSummary: getString("whiteboard-add-summary"),
      noteType: getString("whiteboard-note-type"),
      notePrompt: getString("whiteboard-note-prompt"),
      questionPrompt: getString("whiteboard-question-prompt"),
      claimPrompt: getString("whiteboard-claim-prompt"),
      evidencePrompt: getString("whiteboard-evidence-prompt"),
      summaryPrompt: getString("whiteboard-summary-prompt"),
      editNoteBody: getString("whiteboard-edit-note-body"),
      addFrame: getString("whiteboard-add-frame"),
      addPdf: getString("whiteboard-add-pdf"),
      addFile: getString("whiteboard-add-file"),
      attachFile: getString("whiteboard-attach-file"),
      fileImage: getString("whiteboard-file-image"),
      filePdf: getString("whiteboard-file-pdf"),
      fileText: getString("whiteboard-file-text"),
      fileAudio: getString("whiteboard-file-audio"),
      fileVideo: getString("whiteboard-file-video"),
      fileGeneric: getString("whiteboard-file-generic"),
      fileOpen: getString("whiteboard-file-open"),
      fileDetails: getString("whiteboard-file-details"),
      filePreview: getString("whiteboard-file-preview"),
      fileTooLarge: getString("whiteboard-file-too-large"),
      fileImportFailed: getString("whiteboard-file-import-failed"),
      fileUnavailable: getString("whiteboard-file-unavailable"),
      fileDimensions: getString("whiteboard-file-dimensions"),
      filePages: getString("whiteboard-file-pages"),
      addText: getString("whiteboard-add-text"),
      addRect: getString("whiteboard-add-rect"),
      addRoundedRect: getString("whiteboard-add-rounded-rect"),
      addDiamond: getString("whiteboard-add-diamond"),
      addEllipse: getString("whiteboard-add-ellipse"),
      addLine: getString("whiteboard-add-line"),
      addArrow: getString("whiteboard-add-arrow"),
      kindLiterature: getString("whiteboard-kind-literature"),
      kindQuote: getString("whiteboard-kind-quote"),
      kindNote: getString("whiteboard-kind-note"),
      emptyNote: getString("whiteboard-note-empty"),
      badge: getString("whiteboard-badge"),
      applyTemplate: getString("whiteboard-apply-template"),
      chooseTemplate: getString("whiteboard-choose-template"),
      saveAsTemplate: getString("whiteboard-save-as-template"),
      templateName: getString("whiteboard-template-name"),
      includeTemplateContent: getString("whiteboard-include-template-content"),
      customTemplates: getString("whiteboard-custom-templates"),
      noCustomTemplates: getString("whiteboard-no-custom-templates"),
      renameTemplate: getString("whiteboard-rename-template"),
      duplicateTemplate: getString("whiteboard-duplicate-template"),
      deleteTemplate: getString("whiteboard-delete-template"),
      kindFrame: getString("whiteboard-kind-frame"),
      annotationColor: getString("whiteboard-annotation-color"),
      annotations: {
        one: getString("whiteboard-annotations", { args: { count: 1 } }),
        other: getString("whiteboard-annotations", { args: { count: 2 } }),
      },
      sourceStatus: getString("whiteboard-source-status"),
      sourceIdle: getString("whiteboard-source-idle"),
      sourceAvailable: getString("whiteboard-source-available"),
      sourceLoading: getString("whiteboard-source-loading"),
      sourceMissing: getString("whiteboard-source-missing"),
      attachmentNotDownloaded: getString(
        "whiteboard-attachment-not-downloaded",
      ),
      acquisitionSummary: getString("whiteboard-acquisition-summary", {
        args: {
          successCount: "{successCount}",
          failureCount: "{failureCount}",
        },
      }),
      dropMalformed: getString("whiteboard-drop-malformed"),
      dropUnsupported: getString("whiteboard-drop-unsupported"),
      acquisitionFailed: getString("whiteboard-acquisition-failed"),
      sourceOpenFailed: getString("whiteboard-source-open-failed"),
      sourceRefreshFailed: getString("whiteboard-source-refresh-failed"),
      noteRefreshFailed: getString("whiteboard-note-refresh-failed"),
      failureLibraryMissing: getString("whiteboard-failure-library-missing"),
      failureItemMissing: getString("whiteboard-failure-item-missing"),
      failureWrongKind: getString("whiteboard-failure-wrong-kind"),
      failureParentMismatch: getString("whiteboard-failure-parent-mismatch"),
      failureAttachmentUnavailable: getString(
        "whiteboard-failure-attachment-unavailable",
      ),
      failureAnnotationUnavailable: getString(
        "whiteboard-failure-annotation-unavailable",
      ),
      failureResolutionFailed: getString(
        "whiteboard-failure-resolution-failed",
      ),
      failureOpenFailed: getString("whiteboard-failure-open-failed"),
      failureListFailed: getString("whiteboard-failure-list-failed"),
      openSource: getString("whiteboard-open-source"),
      refreshSource: getString("whiteboard-refresh-source"),
      refreshNote: getString("whiteboard-refresh-note"),
      viewAnnotations: getString("whiteboard-view-annotations"),
      annotationBrowserTitle: getString("whiteboard-annotation-browser-title"),
      searchAnnotations: getString("whiteboard-search-annotations"),
      annotationsLoading: getString("whiteboard-annotations-loading"),
      annotationsEmpty: getString("whiteboard-annotations-empty"),
      annotationsUnavailable: getString("whiteboard-annotations-unavailable"),
      annotationsPartialFailure: getString(
        "whiteboard-annotations-partial-failure",
      ),
      annotationAlreadyAdded: getString("whiteboard-annotation-already-added"),
      focusExistingAnnotation: getString(
        "whiteboard-focus-existing-annotation",
      ),
      addSelectedAnnotations: getString("whiteboard-add-selected-annotations"),
      annotationPage: getString("whiteboard-annotation-page"),
      noteOverwriteTitle: getString("whiteboard-note-overwrite-title"),
      noteOverwriteBody: getString("whiteboard-note-overwrite-body"),
      confirm: getString("whiteboard-confirm"),
      cancel: getString("whiteboard-cancel"),
      eraser: getString("whiteboard-eraser"),
      undo: getString("whiteboard-undo"),
      redo: getString("whiteboard-redo"),
      save: getString("whiteboard-save"),
      searchCanvas: getString("whiteboard-search-canvas"),
      duplicateSelection: getString("whiteboard-duplicate-selection"),
      layoutAllConfirm: getString("whiteboard-layout-all-confirm"),
      editText: getString("whiteboard-edit-text"),
      copy: getString("whiteboard-copy"),
      delete: getString("whiteboard-delete"),
      openItem: getString("whiteboard-open-item"),
      alignLeft: getString("whiteboard-align-left"),
      alignRight: getString("whiteboard-align-right"),
      alignTop: getString("whiteboard-align-top"),
      alignBottom: getString("whiteboard-align-bottom"),
      alignHorizontal: getString("whiteboard-align-horizontal"),
      alignVertical: getString("whiteboard-align-vertical"),
      distributeHorizontal: getString("whiteboard-distribute-horizontal"),
      distributeVertical: getString("whiteboard-distribute-vertical"),
      fitView: getString("whiteboard-fit-view"),
      groupSelection: getString("whiteboard-group-selection"),
      removeFromGroup: getString("whiteboard-remove-from-group"),
      ungroup: getString("whiteboard-ungroup"),
      fitSelection: getString("whiteboard-fit-selection"),
      drawTools: getString("whiteboard-draw-tools"),
      selectionDetails: getString("whiteboard-selection-details"),
      edgeLabel: getString("whiteboard-edge-label"),
      edgeRelation: getString("whiteboard-edge-relation"),
      relationNone: getString("whiteboard-relation-none"),
      relationRelated: getString("whiteboard-relation-related"),
      relationSupports: getString("whiteboard-relation-supports"),
      relationContradicts: getString("whiteboard-relation-contradicts"),
      autoLayout: getString("whiteboard-auto-layout"),
      edgeColor: getString("whiteboard-edge-color"),
      edgeDash: getString("whiteboard-edge-dash"),
      edgeArrow: getString("whiteboard-edge-arrow"),
      edgeStyle: getString("whiteboard-edge-style"),
      edgeArrows: getString("whiteboard-edge-arrows"),
      arrowNone: getString("whiteboard-arrow-none"),
      arrowForward: getString("whiteboard-arrow-forward"),
      arrowReverse: getString("whiteboard-arrow-reverse"),
      arrowBoth: getString("whiteboard-arrow-both"),
      edgeSelection: getString("whiteboard-edge-selection"),
      saved: getString("whiteboard-save-saved"),
      saving: getString("whiteboard-save-saving"),
      saveFailed: getString("whiteboard-save-failed-short"),
      exportPng: getString("whiteboard-export-png"),
      exporting: getString("whiteboard-exporting"),
      exportRenderFailed: getString("whiteboard-export-render-failed"),
      exportSvg: getString("whiteboard-export-svg"),
      exportMarkdown: getString("whiteboard-export-markdown"),
      more: getString("whiteboard-more"),
      shortcutsTitle: getString("whiteboard-shortcuts-title"),
      close: getString("whiteboard-close"),
      stroke: getString("whiteboard-stroke"),
      background: getString("whiteboard-background"),
      transparent: getString("whiteboard-transparent"),
      style: getString("whiteboard-style"),
      batchStyle: getString("whiteboard-batch-style"),
      solid: getString("whiteboard-solid"),
      dashed: getString("whiteboard-dashed"),
      corners: getString("whiteboard-corners"),
      strokeWidth: getString("whiteboard-stroke-width"),
      geometry: getString("whiteboard-geometry"),
      nodeWidth: getString("whiteboard-node-width"),
      nodeHeight: getString("whiteboard-node-height"),
      positionX: getString("whiteboard-position-x"),
      positionY: getString("whiteboard-position-y"),
      format: getString("whiteboard-format"),
      color: getString("whiteboard-color"),
      size: getString("whiteboard-size"),
      alignment: getString("whiteboard-alignment"),
      textAlignment: getString("whiteboard-text-alignment"),
      verticalAlignment: getString("whiteboard-vertical-alignment"),
      fontSystem: getString("whiteboard-font-system"),
      fontGeorgia: getString("whiteboard-font-georgia"),
      fontTimes: getString("whiteboard-font-times"),
      fontInter: getString("whiteboard-font-inter"),
      fontMenlo: getString("whiteboard-font-menlo"),
      fontSerifSc: getString("whiteboard-font-serif-sc"),
      weightRegular: getString("whiteboard-weight-regular"),
      textItalic: getString("whiteboard-text-italic"),
      textUnderline: getString("whiteboard-text-underline"),
      textStrike: getString("whiteboard-text-strike"),
      fontFamily: getString("whiteboard-font-family"),
      fontDefault: getString("whiteboard-font-default"),
      weightBold: getString("whiteboard-weight-bold"),
      commonColors: getString("whiteboard-colors-common"),
      recentColors: getString("whiteboard-colors-recent"),
      opacity: getString("whiteboard-color-opacity"),
      customColor: getString("whiteboard-color-custom"),
      resetColor: getString("whiteboard-color-reset"),
      shortcutSelect: getString("whiteboard-shortcut-select"),
      shortcutHand: getString("whiteboard-shortcut-hand"),
      shortcutFreeMove: getString("whiteboard-shortcut-free-move"),
      shortcutNudge: getString("whiteboard-shortcut-nudge"),
      shortcutNudgeLarge: getString("whiteboard-shortcut-nudge-large"),
      shortcutRect: getString("whiteboard-shortcut-rect"),
      shortcutEllipse: getString("whiteboard-shortcut-ellipse"),
      shortcutArrow: getString("whiteboard-shortcut-arrow"),
      shortcutLine: getString("whiteboard-shortcut-line"),
      shortcutText: getString("whiteboard-shortcut-text"),
      shortcutQuestion: getString("whiteboard-shortcut-question"),
      shortcutClaim: getString("whiteboard-shortcut-claim"),
      shortcutFrame: getString("whiteboard-shortcut-frame"),
      shortcutEraser: getString("whiteboard-shortcut-eraser"),
      shortcutConstrain: getString("whiteboard-shortcut-constrain"),
      shortcutCancel: getString("whiteboard-shortcut-cancel"),
      shortcutDelete: getString("whiteboard-shortcut-delete"),
      shortcutUndo: getString("whiteboard-shortcut-undo"),
      shortcutRedo: getString("whiteboard-shortcut-redo"),
    },
    onChange(rev) {
      session.saveCoordinator?.markChanged(rev);
      refreshTabTitle(session);
      if (!session.transitioning) scheduleAutosave(session);
    },
    onOpenSettings() {
      void import("../markdown/settings").then(({ openMarkdownSettings }) =>
        openMarkdownSettings(
          session.win as _ZoteroTypes.MainWindow,
          "whiteboard",
        ),
      );
    },
    onSwitchWindow() {
      const item = Zotero.Items.get(session.itemID);
      if (item)
        void openWhiteboardSurface(item, {
          surface: session.surface === "window" ? "tab" : "window",
        }).catch((error) => {
          ztoolkit.log("Failed to switch Canvas window", error);
          toast(getString("whiteboard-open-failed"));
        });
    },
    onOpenLink(href) {
      const item = Zotero.Items.get(session.itemID);
      if (item) navigateDocumentLink(item, win, href);
    },
    onOpenFile(payload) {
      void openEmbeddedFile(
        session,
        payload.nodeId,
        payload.attachmentId,
      ).catch((error) => {
        ztoolkit.log("Failed to open embedded whiteboard file", error);
        const message = error instanceof Error ? error.message : String(error);
        const unavailable = getString("whiteboard-file-unavailable");
        const tooLarge = getString("whiteboard-file-too-large");
        toast(
          message === unavailable || message === tooLarge
            ? message
            : getString("whiteboard-file-import-failed"),
        );
      });
    },
    onSave() {
      void saveSession(session);
    },
    onSaveNoteTemplate(template) {
      void templateRepository.save(template).catch((error) => {
        ztoolkit.log("Failed to save Note template", error);
        session.editor?.setTemplates(templateRepository.list());
      });
    },
    onDeleteNoteTemplate(templateId) {
      void templateRepository.remove(templateId).catch((error) => {
        ztoolkit.log("Failed to delete Note template", error);
        session.editor?.setTemplates(templateRepository.list());
      });
    },
    onError(message) {
      toast(message);
    },
    onPickAcademicSource(requestId, nodeId, kind) {
      void handlePickAcademicSource(session, requestId, nodeId, kind);
    },
    onOpenItem(payload) {
      openZoteroItem(payload);
    },
    resolveNativeAcademicDrop(dataTransfer) {
      return resolveNativeAcademicDrop(dataTransfer);
    },
    onNativeAcademicDropRejected(requestId, code, diagnostic) {
      reportAcademicRequestFailure({
        operation: "drop",
        requestId,
        code,
        diagnostic,
      });
    },
    onDropAcademicSources(requestId, nodeId, sources) {
      void handleDropAcademicSources(session, requestId, nodeId, sources);
    },
    onResolveAcademicSources(_requestId, generation, priority, sources) {
      const scheduler = session.sourceScheduler;
      if (!scheduler) return;
      if (
        session.sourceGeneration !== undefined &&
        generation < session.sourceGeneration
      ) {
        return;
      }
      if (session.sourceGeneration !== generation) {
        if (session.sourceGeneration !== undefined) {
          scheduler.cancelGeneration(session.sourceGeneration);
        }
        session.sourceGeneration = generation;
      }
      for (const { nodeId, source, refresh } of sources) {
        const cacheKey = sourceCacheKey(source);
        if (refresh) scheduler.invalidate(cacheKey);
        scheduler.promote(cacheKey, priority);
        scheduler.enqueue({
          nodeId,
          generation,
          priority,
          descriptor: source,
          cacheKey,
        });
      }
    },
    onRefreshZoteroNote(requestId, nodeId, source) {
      void handleRefreshZoteroNote(session, requestId, nodeId, source);
    },
    onOpenAcademicSource(requestId, nodeId, source) {
      void handleOpenAcademicSource(
        session,
        requestId,
        nodeId,
        source,
        gateway,
      );
    },
    onListLiteratureAnnotations(requestId, source) {
      void handleListLiteratureAnnotations(session, requestId, source);
    },
    onExportFile(payload) {
      void handleExportFile(session, payload);
    },
  });
  session.unsubscribeTemplates = templateRepository.subscribe(() => {
    session.editor?.setTemplates(templateRepository.list());
  });
  bindSessionTheme(win, session);
}

type SurfaceOptions = {
  win?: _ZoteroTypes.MainWindow;
  shouldOpen?: () => boolean;
  surface?: "tab" | "window" | "sidebar";
  container?: HTMLElement;
  onClose?: () => void;
};

export function openWhiteboardTab(
  item: Zotero.Item,
  options: {
    win?: _ZoteroTypes.MainWindow;
    shouldOpen?: () => boolean;
  } = {},
): Promise<string | null> {
  // Opening an attachment again focuses its current surface.
  return openWhiteboardSurface(item, {
    ...options,
    ...(whiteboardRegistry.findByItem(item.id)?.surface === "sidebar"
      ? { surface: "tab" as const }
      : {}),
  });
}

/** Sidebar renders never move an editor that is already open elsewhere. */
export function openWhiteboardSidebar(
  item: Zotero.Item,
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
  onClose?: () => void,
) {
  return whiteboardRegistry.withItemLock(item.id, async () => {
    const existing = whiteboardRegistry.findByItem(item.id);
    if (existing && !existing.win.closed) return null;
    return mountWhiteboardSurface(item, {
      win,
      surface: "sidebar",
      container,
      onClose,
    });
  });
}

export function openWhiteboardWindow(
  item: Zotero.Item,
  options: { win?: _ZoteroTypes.MainWindow } = {},
): Promise<string | null> {
  return openWhiteboardSurface(item, { ...options, surface: "window" });
}

function openWhiteboardSurface(item: Zotero.Item, options: SurfaceOptions) {
  return whiteboardRegistry.withItemLock(item.id, () =>
    mountWhiteboardSurface(item, options),
  );
}

function focusWhiteboard(session: WhiteboardSession) {
  session.win.focus();
  if (session.surface !== "window" && session.surface !== "sidebar") {
    (session.win as _ZoteroTypes.MainWindow).Zotero_Tabs.select(session.tabID);
  }
  session.editor?.focus();
}

async function mountWhiteboardSurface(
  item: Zotero.Item,
  options: SurfaceOptions,
) {
  if (options.shouldOpen?.() === false) return null;
  if (!isWhiteboardAttachment(item)) return null;
  let existing = whiteboardRegistry.findByItem(item.id);
  if (existing?.closePromise) await existing.closePromise;
  if (options.shouldOpen?.() === false) return null;
  existing = whiteboardRegistry.findByItem(item.id);
  if (existing && !existing.win.closed) {
    if (!options.surface || options.surface === (existing.surface ?? "tab")) {
      focusWhiteboard(existing);
      return existing.tabID;
    }
  } else if (existing) {
    disposeWhiteboardSession(existing);
    existing = undefined;
  }
  const mainWin = options.win || Zotero.getMainWindow();
  if (!mainWin) return null;
  const surface = options.surface ?? "tab";
  let session: WhiteboardSession | undefined;
  let closeHost: (() => void) | undefined;
  const cancelIfRequested = () => {
    if (options.shouldOpen?.() !== false) return false;
    if (session) disposeWhiteboardSession(session);
    closeHost?.();
    return true;
  };
  if (existing) {
    existing.transitioning = true;
    if (existing.view) existing.view.root.inert = true;
  }
  try {
    const path = await item.getFilePathAsync();
    if (cancelIfRequested()) return null;
    if (!path) throw new Error(getString("whiteboard-open-failed"));
    // A surface change needs a fresh snapshot, but does not require overwriting
    // an externally changed file. Conflicting drafts keep their old baseline.
    const parsed = await captureWhiteboardSurfaceTransfer(existing ?? {}, () =>
      readCanvasFile(path),
    );
    if (cancelIfRequested()) return null;
    for (const issue of parsed.issues) {
      ztoolkit.log("Canvas parse issue", {
        code: issue.code,
        objectId: issue.id,
        message: issue.message,
      });
    }
    const canvasId = newCanvasId();
    const title = attachmentTitle(item);
    let win: Window = mainWin;
    let tabID: string;
    let host: HTMLElement;
    if (surface === "sidebar") {
      if (!options.container?.isConnected) return null;
      host = options.container;
      closeHost = options.onClose;
      tabID = `whiteboard-sidebar-${canvasId}`;
      injectWhiteboardStyles(win);
    } else if (surface === "window") {
      const opened = mainWin.openDialog(
        `chrome://${addon.data.config.addonRef}/content/whiteboardWindow.xhtml`,
        "_blank",
        "chrome,dialog=no,centerscreen,resizable,width=1200,height=800,minwidth=640,minheight=480",
      );
      if (!opened) throw new Error(getString("whiteboard-open-failed"));
      win = opened;
      const onClose = (event: Event) => {
        event.preventDefault();
        if (session && !session.transitioning) {
          void closeWhiteboardSession(session.tabID).catch((error) => {
            ztoolkit.log("Failed to close Canvas window", error);
          });
        }
      };
      const onUnload = (event: Event) => {
        if (
          (event.target !== win && event.target !== win.document) ||
          !session ||
          whiteboardRegistry.get(session.tabID) !== session
        )
          return;
        forgetOpenDocument(session.itemID);
        try {
          disposeWhiteboardSession(session);
        } finally {
          refreshWhiteboardSidebar();
        }
      };
      closeHost = () => {
        win.removeEventListener("close", onClose);
        win.removeEventListener("DOMWindowClose", onClose, true);
        win.removeEventListener("unload", onUnload, true);
        if (!win.closed) win.close();
      };
      await new Promise<void>((resolve, reject) => {
        if (win.document.getElementById("bamboo-whiteboard-window-root")) {
          resolve();
          return;
        }
        const timer = mainWin.setTimeout(() => {
          win.removeEventListener("load", loaded);
          reject(new Error(getString("whiteboard-open-failed")));
        }, 8000);
        const loaded = () => {
          mainWin.clearTimeout(timer);
          resolve();
        };
        win.addEventListener("load", loaded, { once: true });
      });
      if (cancelIfRequested()) return null;
      const root = win.document.getElementById("bamboo-whiteboard-window-root");
      if (!root) throw new Error(getString("whiteboard-open-failed"));
      // Bind to the loaded chrome document, rather than its initial about:blank window.
      win.addEventListener("close", onClose);
      win.addEventListener("DOMWindowClose", onClose, true);
      win.addEventListener("unload", onUnload, true);
      host = root;
      tabID = `whiteboard-window-${canvasId}`;
      injectWhiteboardStyles(win);
    } else {
      const tab = mainWin.Zotero_Tabs.add({
        type: WHITEBOARD_TAB_TYPE,
        title,
        data: { itemID: item.id, canvasId },
        select: false,
        onClose: () => {
          void closeWhiteboardSession(tab.id);
        },
      });
      tabID = tab.id;
      host = tab.container as unknown as HTMLElement;
      closeHost = () => mainWin.Zotero_Tabs.close(tabID);
    }
    ensureDOMGlobals(win);
    host.classList.add("zotero-whiteboard-tab-content");
    host.setAttribute("flex", "1");
    session = {
      tabID,
      canvasId,
      fileRevision: parsed.revision,
      itemID: item.id,
      win,
      path,
      title,
      surface,
      transitioning: true,
      closeHost,
    };
    mountWhiteboardUI(win, host, session, parsed.document);
    session.view!.root.inert = true;
    // A failed iframe load must leave the original editor intact.
    await new Promise<void>((resolve, reject) => {
      const timer = mainWin.setTimeout(
        () => reject(new Error("Canvas editor load timeout")),
        10000,
      );
      session!
        .editor!.ready.then(resolve, reject)
        .finally(() => mainWin.clearTimeout(timer));
    });
    if (cancelIfRequested()) return null;
    if (existing) {
      // Acquire once more after loading, in case an in-flight source operation completed.
      const transferred = await captureWhiteboardSurfaceTransfer(existing, () =>
        readCanvasFile(path),
      );
      if (cancelIfRequested()) return null;
      session.editor!.loadSnapshot(transferred.document);
      session.fileRevision = transferred.revision;
      const loaded = await session.editor!.requestSnapshot();
      if (cancelIfRequested()) return null;
      if (transferred.conflict) {
        session.saveCoordinator!.adoptUnsavedSnapshot(transferred.conflict);
        toast(transferred.conflict.message);
      } else {
        session.saveCoordinator!.adoptPersistedSnapshot({
          rev: loaded.rev,
          document: parseCanvasDocument(loaded.snapshot).document,
        });
      }
      disposeWhiteboardSession(existing);
      existing.closeHost?.();
    }
    whiteboardRegistry.register(session);
    if (surface !== "sidebar")
      rememberDocument(item.id, { kind: "canvas", surface, open: true });
    session.transitioning = false;
    session.view!.root.inert = false;
    refreshTabTitle(session);
    if (surface !== "sidebar") focusWhiteboard(session);
    return tabID;
  } catch (error) {
    if (session) disposeWhiteboardSession(session);
    closeHost?.();
    if (options.shouldOpen?.() === false) return null;
    ztoolkit.log("Failed to open whiteboard", error);
    throw error;
  } finally {
    if (existing) {
      existing.transitioning = false;
      if (existing.view) existing.view.root.inert = false;
    }
  }
}

function disposeWhiteboardSession(session: WhiteboardSession) {
  session.closing = true;
  try {
    // Mount can fail before registration; the registry cannot clean that session.
    const unbindVisibility = session.unbindSourceVisibility;
    session.unbindSourceVisibility = undefined;
    unbindVisibility?.();
    if (session.autosaveTimer) session.win.clearTimeout(session.autosaveTimer);
    session.unbindTheme?.();
    session.unsubscribeTemplates?.();
    session.unsubscribeTemplates = undefined;
    session.sourceScheduler?.dispose();
    session.sourceScheduler = undefined;
    session.editor?.destroy();
    session.view?.root.remove();
  } finally {
    whiteboardRegistry.unregister(session.tabID);
  }
}

function refreshWhiteboardSidebar() {
  void Zotero.Notifier?.trigger("refresh", "itempane", [], {}).catch(
    (error) => {
      ztoolkit.log("Failed to refresh whiteboard sidebar", error);
    },
  );
}

export function closeWhiteboardSession(tabID: string): Promise<boolean> {
  const session = whiteboardRegistry.get(tabID);
  if (!session || session.closing) return Promise.resolve(true);
  if (session.transitioning) return Promise.resolve(false);
  if (session.closePromise) return session.closePromise;
  const closing = (async () => {
    if (session.autosaveTimer) {
      session.win.clearTimeout(session.autosaveTimer);
      session.autosaveTimer = undefined;
    }
    if (session.view) session.view.root.inert = true;
    try {
      if (session.surface === "window" || session.surface === "sidebar") {
        // Native close is cancelled until this final snapshot is safely on disk.
        await session.saveCoordinator?.request({ force: true });
      } else if (isDirty(session)) {
        if (promptUnsaved(session.win) === "save") {
          await session.saveCoordinator?.request({ force: true });
        }
      } else {
        await session.saveCoordinator?.flush();
      }
      forgetOpenDocument(session.itemID);
      disposeWhiteboardSession(session);
      if (session.surface === "window") {
        session.closeHost?.();
        refreshWhiteboardSidebar();
      }
      return true;
    } catch (error) {
      ztoolkit.log("Failed to close whiteboard", error);
      toast(getString("whiteboard-save-failed"));
      return false;
    } finally {
      session.closePromise = undefined;
      if (session.view) session.view.root.inert = false;
    }
  })();
  session.closePromise = closing;
  return closing;
}

export async function closeWhiteboardsForWindow(win: Window) {
  await Promise.all(
    whiteboardRegistry
      .sessionsForWindow(win)
      .map((session) => closeWhiteboardSession(session.tabID)),
  );
}

export async function closeAllWhiteboards() {
  await whiteboardRegistry.waitForOperations();
  await Promise.all(
    whiteboardRegistry.all().map(async (session) => {
      const closed = await closeWhiteboardSession(session.tabID);
      if (closed && (session.surface ?? "tab") === "tab") session.closeHost?.();
    }),
  );
}

export async function flushAllWhiteboards(): Promise<void> {
  await whiteboardRegistry.waitForOperations();
  await Promise.all(
    whiteboardRegistry
      .all()
      .map((session) => session.saveCoordinator?.flush() ?? Promise.resolve()),
  );
}
