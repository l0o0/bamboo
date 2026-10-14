/**
 * Parent-side canvas: mounts a chrome:// iframe and bridges via postMessage.
 */

import {
  normalizeColorScheme,
  type ColorSchemeID,
} from "../../../packages/whiteboard/src/model/colorSchemes";
import { resolveEditorTheme } from "../markdown/editor";
import { ensureDOMGlobals } from "../../utils/dom";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  readWhiteboardToParentMessageEvent,
  type AcademicAcquisition,
  type AcademicAcquisitionFailure,
  type AcademicDropFailureCode,
  type AcademicDropSourceRef,
  type AcademicRequestFailureCode,
  type AcademicSourceDescriptor,
  type AcademicSourceActionFailure,
  type AnnotationCandidate,
  type AnnotationListFailure,
  type ParentToWhiteboardMessage,
  type IndexedAcademicAcquisition,
  type SourceResolutionPriority,
  type SourceResolutionResult,
  type WhiteboardLabels,
  type WhiteboardAppearance,
  type WhiteboardTheme,
} from "./protocol";
import type { CanvasDocument } from "./snapshot";
import type { LiteratureSource, NoteSource } from "./snapshot";
import type { NoteTemplate } from "../../../packages/whiteboard/src/model/note-template";

export interface WhiteboardHandle {
  ready: Promise<void>;
  focus: () => void;
  destroy: () => void;
  setColorScheme: (colorScheme: ColorSchemeID) => void;
  setAppearance: (appearance: WhiteboardAppearance) => void;
  setTheme: (theme: WhiteboardTheme) => void;
  setTemplates: (templates: NoteTemplate[]) => void;
  loadSnapshot: (snapshot: CanvasDocument) => void;
  requestSnapshot: () => Promise<{
    rev: number;
    snapshot: CanvasDocument;
  }>;
  command: (command: "undo" | "redo") => void;
  resolveAcademicAcquisitionBatch: (
    requestId: string,
    nodeId: string,
    successes: IndexedAcademicAcquisition[],
    failures: AcademicAcquisitionFailure[],
  ) => void;
  rejectAcademicRequest: (
    requestId: string,
    nodeId: string,
    code: AcademicRequestFailureCode,
    diagnostic?: string,
  ) => void;
  rejectSourceAction: (
    requestId: string,
    nodeId: string,
    source: AcademicSourceDescriptor,
    failure: AcademicSourceActionFailure,
  ) => void;
  acceptSourceAction: (
    requestId: string,
    nodeId: string,
    action: "open",
    source: AcademicSourceDescriptor,
  ) => void;
  applySourceResolutionBatch: (
    requestId: string,
    generation: number,
    results: SourceResolutionResult[],
  ) => void;
  applyNoteRefresh: (
    requestId: string,
    nodeId: string,
    acquisition: Extract<AcademicAcquisition, { kind: "note" }>,
  ) => void;
  applyAnnotationCandidates: (
    requestId: string,
    source: LiteratureSource,
    candidates: AnnotationCandidate[],
    failures: AnnotationListFailure[],
  ) => void;
  rejectAnnotationList: (
    requestId: string,
    source: LiteratureSource,
    failure: AnnotationListFailure,
  ) => void;
  setSaveState: (state: "saved" | "saving" | "error") => void;
}

export type NativeAcademicDropResolution =
  | { status: "ignored" }
  | {
      status: "rejected";
      code: AcademicDropFailureCode;
      diagnostic?: string;
    }
  | { status: "accepted"; sources: AcademicDropSourceRef[] };

type AcademicDropEventTarget = {
  addEventListener(
    type: string,
    listener: (event: DragEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: DragEvent) => void,
    capture?: boolean,
  ): void;
};

export type NativeAcademicDropEvent =
  | { code: AcademicDropFailureCode; diagnostic?: string }
  | {
      position: { x: number; y: number };
      sources: AcademicDropSourceRef[];
    };

export function attachNativeAcademicDropListeners(
  target: AcademicDropEventTarget,
  resolve: (dataTransfer: DataTransfer) => NativeAcademicDropResolution,
  emit: (drop: NativeAcademicDropEvent) => void,
): () => void {
  const onDragOver = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (
      !types.some((type) =>
        ["zotero/collection", "zotero/item", "zotero/search"].includes(type),
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    let resolved: NativeAcademicDropResolution;
    try {
      resolved = resolve(transfer);
    } catch (error) {
      event.preventDefault();
      event.stopPropagation();
      emit({
        code: "drop-malformed",
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (resolved.status === "ignored") return;
    event.preventDefault();
    event.stopPropagation();
    if (resolved.status === "rejected") {
      emit({ code: resolved.code, diagnostic: resolved.diagnostic });
      return;
    }
    emit({
      position: { x: event.clientX, y: event.clientY },
      sources: resolved.sources,
    });
  };
  target.addEventListener("dragenter", onDragOver, true);
  target.addEventListener("dragover", onDragOver, true);
  target.addEventListener("drop", onDrop, true);
  return () => {
    target.removeEventListener("dragenter", onDragOver, true);
    target.removeEventListener("dragover", onDragOver, true);
    target.removeEventListener("drop", onDrop, true);
  };
}

function whiteboardPageURL() {
  const ref = addon.data.config.addonRef;
  return `chrome://${ref}/content/whiteboard/index.html`;
}

type PendingCommand = Extract<
  ParentToWhiteboardMessage,
  {
    type:
      | "init"
      | "setTheme"
      | "setAppearance"
      | "setColorScheme"
      | "loadSnapshot"
      | "command"
      | "focus"
      | "destroy"
      | "academicSourcesAcquired"
      | "academicDropStarted"
      | "academicDropRejected"
      | "sourceResolutionBatch"
      | "noteRefreshed"
      | "annotationsListed"
      | "annotationListFailed"
      | "academicRequestFailed"
      | "sourceActionFailed"
      | "sourceActionSucceeded"
      | "saveState"
      | "noteTemplatesChanged";
  }
>;

export function createWhiteboardEditor(
  parent: HTMLElement,
  options: {
    win?: Window;
    channel?: string;
    snapshot?: CanvasDocument | null;
    editable?: boolean;
    labels?: WhiteboardLabels;
    templates?: NoteTemplate[];
    appearance?: WhiteboardAppearance;
    colorScheme?: ColorSchemeID;
    onChange?: (rev: number) => void;
    onSave?: () => void;
    onOpenSettings?: () => void;
    onSwitchWindow?: () => void;
    onSaveNoteTemplate?: (template: NoteTemplate) => void;
    onDeleteNoteTemplate?: (templateId: string) => void;
    onError?: (message: string) => void;
    onPickAcademicSource?: (
      requestId: string,
      nodeId: string,
      kind: "literature",
    ) => void;
    onOpenLink?: (href: string) => void;
    onOpenFile?: (payload: { nodeId: string; attachmentId?: string }) => void;
    onOpenItem?: (payload: {
      itemID?: number;
      attachmentID?: number;
      pdfPage?: number;
    }) => void;
    resolveNativeAcademicDrop?: (
      dataTransfer: DataTransfer,
    ) => NativeAcademicDropResolution;
    onNativeAcademicDropRejected?: (
      requestId: string,
      code: AcademicDropFailureCode,
      diagnostic?: string,
    ) => void;
    onDropAcademicSources?: (
      requestId: string,
      nodeId: string,
      sources: AcademicDropSourceRef[],
    ) => void;
    onResolveAcademicSources?: (
      requestId: string,
      generation: number,
      priority: SourceResolutionPriority,
      sources: Array<{
        nodeId: string;
        source: AcademicSourceDescriptor;
        refresh?: boolean;
      }>,
    ) => void;
    onOpenAcademicSource?: (
      requestId: string,
      nodeId: string,
      source: AcademicSourceDescriptor,
    ) => void;
    onRefreshZoteroNote?: (
      requestId: string,
      nodeId: string,
      source: NoteSource,
    ) => void;
    onListLiteratureAnnotations?: (
      requestId: string,
      source: LiteratureSource,
    ) => void;
    onExportFile?: (payload: {
      requestId: string;
      format: "png" | "svg" | "md";
      mimeType: string;
      dataUrl?: string;
      text?: string;
    }) => void;
  } = {},
): WhiteboardHandle {
  const ownerWin =
    options.win || parent.ownerDocument?.defaultView || undefined;
  ensureDOMGlobals(ownerWin || undefined);

  const channel = options.channel || "";
  const documentRef = parent.ownerDocument || (globalThis as any).document;
  if (!documentRef) {
    throw new Error("No document available for whiteboard");
  }

  while (parent.firstChild) parent.removeChild(parent.firstChild);

  const wrap = documentRef.createElement("div");
  wrap.className = "zmd-whiteboard-wrap";

  const iframe = documentRef.createElement("iframe") as HTMLIFrameElement;
  iframe.className = "zmd-whiteboard-iframe";
  iframe.setAttribute(
    "src",
    `${whiteboardPageURL()}?channel=${encodeURIComponent(channel)}&v=${Date.now()}`,
  );
  Object.assign(iframe.style, {
    border: "none",
    width: "100%",
    height: "100%",
    flex: "1 1 auto",
    minHeight: "0",
    minWidth: "0",
    display: "block",
    background: "transparent",
  });

  wrap.appendChild(iframe);
  parent.appendChild(wrap);

  let destroyed = false;
  let iframeReady = false;
  let pendingSnapshot = options.snapshot ?? null;
  const pending: PendingCommand[] = [];
  const snapshotWaiters = new Map<
    string,
    {
      resolve: (value: { rev: number; snapshot: CanvasDocument }) => void;
      reject: (reason: Error) => void;
      timeoutId?: number;
    }
  >();

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const post = (message: ParentToWhiteboardMessage) => {
    const target = iframe.contentWindow;
    if (!target) return false;
    target.postMessage(
      { ...message, channel, v: WHITEBOARD_PROTOCOL_VERSION },
      "*",
    );
    return true;
  };

  const sendOrQueue = (message: PendingCommand) => {
    if (destroyed) return;
    if (!iframeReady) {
      if (
        message.type === "init" ||
        message.type === "setTheme" ||
        message.type === "setAppearance" ||
        message.type === "setColorScheme" ||
        message.type === "loadSnapshot"
      ) {
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].type === message.type) pending.splice(i, 1);
        }
      }
      pending.push(message);
      return;
    }
    post(message);
  };

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    const data = readWhiteboardToParentMessageEvent(
      event,
      iframe.contentWindow,
      channel,
    );
    if (!data) return;

    switch (data.type) {
      case "ready": {
        iframeReady = true;
        post({
          source: WHITEBOARD_MESSAGE_SOURCE,
          type: "init",
          payload: {
            ...(options.editable !== undefined
              ? { editable: options.editable }
              : {}),
            theme: resolveEditorTheme(ownerWin),
            colorScheme: normalizeColorScheme(options.colorScheme),
            ...(options.appearance ? { appearance: options.appearance } : {}),
            snapshot: pendingSnapshot,
            ...(options.labels ? { labels: options.labels } : {}),
            ...(options.templates ? { templates: options.templates } : {}),
          },
        });
        for (const cmd of pending.splice(0, pending.length)) post(cmd);
        resolveReady();
        break;
      }
      case "change":
        options.onChange?.(data.payload.rev);
        break;
      case "snapshot": {
        const waiter = snapshotWaiters.get(data.payload.requestId);
        snapshotWaiters.delete(data.payload.requestId);
        if (waiter) {
          if (waiter.timeoutId !== undefined) {
            ownerWin?.clearTimeout(waiter.timeoutId);
          }
          waiter.resolve({
            rev: data.payload.rev,
            snapshot: data.payload.snapshot,
          });
        }
        break;
      }
      case "openSettings":
        options.onOpenSettings?.();
        break;
      case "switchWindow":
        options.onSwitchWindow?.();
        break;
      case "save":
        options.onSave?.();
        break;
      case "saveNoteTemplate":
        options.onSaveNoteTemplate?.(data.payload.template);
        break;
      case "deleteNoteTemplate":
        options.onDeleteNoteTemplate?.(data.payload.templateId);
        break;
      case "pickAcademicSource":
        options.onPickAcademicSource?.(
          data.payload.requestId,
          data.payload.nodeId,
          data.payload.kind,
        );
        break;
      case "openLink":
        options.onOpenLink?.(data.payload.href);
        break;
      case "openFile":
        options.onOpenFile?.(data.payload);
        break;
      case "openItem":
        options.onOpenItem?.(data.payload);
        break;
      case "dropAcademicSources":
        options.onDropAcademicSources?.(
          data.payload.requestId,
          data.payload.nodeId,
          data.payload.sources,
        );
        break;
      case "resolveAcademicSources":
        options.onResolveAcademicSources?.(
          data.payload.requestId,
          data.payload.generation,
          data.payload.priority,
          data.payload.sources,
        );
        break;
      case "openAcademicSource":
        options.onOpenAcademicSource?.(
          data.payload.requestId,
          data.payload.nodeId,
          data.payload.source,
        );
        break;
      case "refreshZoteroNote":
        options.onRefreshZoteroNote?.(
          data.payload.requestId,
          data.payload.nodeId,
          data.payload.source,
        );
        break;
      case "listLiteratureAnnotations":
        options.onListLiteratureAnnotations?.(
          data.payload.requestId,
          data.payload.source,
        );
        break;
      case "exportFile":
        options.onExportFile?.(data.payload);
        break;
      case "error":
        options.onError?.(data.payload.message);
        break;
      default:
        break;
    }
  };

  ownerWin?.addEventListener("message", onMessage);

  let dropSequence = 0;
  const emitNativeDrop = (drop: NativeAcademicDropEvent) => {
    const suffix = `${Date.now().toString(36)}-${dropSequence++}`;
    if ("code" in drop) {
      options.onNativeAcademicDropRejected?.(
        `drop-${suffix}`,
        drop.code,
        drop.diagnostic,
      );
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "academicDropRejected",
        payload: { code: drop.code },
      });
      return;
    }
    sendOrQueue({
      source: WHITEBOARD_MESSAGE_SOURCE,
      type: "academicDropStarted",
      payload: {
        requestId: `drop-${suffix}`,
        nodeId: `literature-${suffix}`,
        position: drop.position,
        sources: drop.sources,
      },
    });
  };
  // Native cross-window drags may target the iframe element in the outer
  // document. Those events do not reach the iframe's document listener.
  const detachOuterDropListeners = options.resolveNativeAcademicDrop
    ? attachNativeAcademicDropListeners(
        wrap,
        options.resolveNativeAcademicDrop,
        (drop) => {
          if ("code" in drop) {
            emitNativeDrop(drop);
            return;
          }
          const rect = iframe.getBoundingClientRect();
          emitNativeDrop({
            ...drop,
            position: {
              x: drop.position.x - rect.left,
              y: drop.position.y - rect.top,
            },
          });
        },
      )
    : () => undefined;
  let detachDropListeners: () => void = () => undefined;
  const attachDropListeners = () => {
    detachDropListeners();
    const target = iframe.contentDocument;
    if (!target || !options.resolveNativeAcademicDrop) return;
    detachDropListeners = attachNativeAcademicDropListeners(
      target,
      options.resolveNativeAcademicDrop,
      emitNativeDrop,
    );
  };
  iframe.addEventListener("load", attachDropListeners);
  if (iframe.contentDocument?.readyState === "complete") attachDropListeners();

  return {
    ready,
    focus() {
      sendOrQueue({ source: WHITEBOARD_MESSAGE_SOURCE, type: "focus" });
      try {
        iframe.focus();
      } catch {
        // ignore
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ownerWin?.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", attachDropListeners);
      detachDropListeners();
      detachOuterDropListeners();
      for (const waiter of snapshotWaiters.values()) {
        if (waiter.timeoutId !== undefined) {
          ownerWin?.clearTimeout(waiter.timeoutId);
        }
        waiter.reject(new Error("whiteboard destroyed"));
      }
      snapshotWaiters.clear();
      post({ source: WHITEBOARD_MESSAGE_SOURCE, type: "destroy" });
      iframe.remove();
      wrap.remove();
    },
    setColorScheme(colorScheme) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "setColorScheme",
        payload: { colorScheme },
      });
    },
    setAppearance(appearance) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "setAppearance",
        payload: { appearance },
      });
    },
    setTheme(theme) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "setTheme",
        payload: { theme },
      });
    },
    setTemplates(templates) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "noteTemplatesChanged",
        payload: { templates },
      });
    },
    loadSnapshot(snapshot) {
      pendingSnapshot = snapshot;
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "loadSnapshot",
        payload: { snapshot },
      });
    },
    requestSnapshot() {
      const requestId = `snap-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        if (destroyed) {
          reject(new Error("whiteboard destroyed"));
          return;
        }
        const waiter = { resolve, reject } as {
          resolve: (value: { rev: number; snapshot: CanvasDocument }) => void;
          reject: (reason: Error) => void;
          timeoutId?: number;
        };
        snapshotWaiters.set(requestId, waiter);
        post({
          source: WHITEBOARD_MESSAGE_SOURCE,
          type: "requestSnapshot",
          payload: { requestId },
        });
        waiter.timeoutId = ownerWin?.setTimeout?.(() => {
          if (snapshotWaiters.delete(requestId)) {
            reject(new Error("snapshot timeout"));
          }
        }, 8000);
      });
    },
    command(command) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "command",
        payload: { command },
      });
    },
    resolveAcademicAcquisitionBatch(requestId, nodeId, successes, failures) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "academicSourcesAcquired",
        payload: { requestId, nodeId, successes, failures },
      });
    },
    rejectAcademicRequest(requestId, nodeId, code, diagnostic) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "academicRequestFailed",
        payload: {
          requestId,
          nodeId,
          code,
          ...(diagnostic !== undefined ? { diagnostic } : {}),
        },
      });
    },
    rejectSourceAction(requestId, nodeId, source, failure) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "sourceActionFailed",
        payload: { requestId, nodeId, source, failure },
      });
    },
    acceptSourceAction(requestId, nodeId, action, source) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "sourceActionSucceeded",
        payload: { requestId, nodeId, action, source },
      });
    },
    applySourceResolutionBatch(requestId, generation, results) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "sourceResolutionBatch",
        payload: { requestId, generation, results },
      });
    },
    applyNoteRefresh(requestId, nodeId, acquisition) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "noteRefreshed",
        payload: { requestId, nodeId, acquisition },
      });
    },
    applyAnnotationCandidates(requestId, source, candidates, failures) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "annotationsListed",
        payload: { requestId, source, candidates, failures },
      });
    },
    rejectAnnotationList(requestId, source, failure) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "annotationListFailed",
        payload: { requestId, source, failure },
      });
    },
    setSaveState(state) {
      sendOrQueue({
        source: WHITEBOARD_MESSAGE_SOURCE,
        type: "saveState",
        payload: { state },
      });
    },
  };
}
