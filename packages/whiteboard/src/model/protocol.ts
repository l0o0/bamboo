/**
 * postMessage protocol between the Zotero tab (parent) and the
 * whiteboard iframe (@xyflow/react host). Lives in the isolated
 * packages/whiteboard app so the canvas does not import plugin code.
 *
 * Pure module: no Zotero APIs. Distinct source from the Markdown editor
 * so the two iframes cannot accept each other's messages.
 */

import type { ColorSchemeID } from "./colorSchemes";

import type {
  AttachmentSnapshot,
  AttachmentSource,
  LiteratureSnapshot,
  LiteratureSource,
  NoteSource,
  NoteSourceSnapshot,
  QuoteSnapshot,
  QuoteSource,
} from "./academic";
import {
  parseCanvasDocument,
  parseLiteratureSource,
  parseNoteSource,
  parseQuoteSource,
  parseLiteratureSnapshot,
  parseQuoteSnapshot,
  parseNoteSourceSnapshot,
  type CanvasDocument,
} from "./document";
import { parseNoteTemplate, type NoteTemplate } from "./note-template";

export const WHITEBOARD_MESSAGE_SOURCE = "zotero-markdown-whiteboard" as const;
export const WHITEBOARD_PROTOCOL_VERSION = 2;

export type WhiteboardTheme = "light" | "dark";

export type WhiteboardFontFamily = "system" | "serif" | "mono";

export interface WhiteboardAppearance {
  fontFamily: WhiteboardFontFamily;
  /** Empty follows the active theme; otherwise a validated six-digit hex. */
  backgroundColor: string;
}

export type WhiteboardCommand = "undo" | "redo";

export interface WhiteboardProtocolMessage {
  source: typeof WHITEBOARD_MESSAGE_SOURCE;
  channel?: string;
  v?: typeof WHITEBOARD_PROTOCOL_VERSION;
}

export interface WhiteboardLabels {
  searchCanvas?: string;
  duplicateSelection?: string;
  layoutAllConfirm?: string;

  canvas: string;
  selection: string;
  select: string;
  hand: string;
  addItem: string;
  addNote: string;
  addQuestion: string;
  addClaim: string;
  addEvidence: string;
  addSummary: string;
  noteType: string;
  notePrompt: string;
  questionPrompt: string;
  claimPrompt: string;
  evidencePrompt: string;
  summaryPrompt: string;
  editNoteBody: string;
  addFrame: string;
  addPdf: string;
  addFile: string;
  attachFile: string;
  fileImage: string;
  filePdf: string;
  fileText: string;
  fileAudio: string;
  fileVideo: string;
  fileGeneric: string;
  fileOpen: string;
  fileDetails: string;
  filePreview: string;
  fileTooLarge: string;
  fileImportFailed: string;
  fileUnavailable: string;
  fileDimensions: string;
  filePages: string;
  addText: string;
  addRect: string;
  addRoundedRect: string;
  addDiamond: string;
  addEllipse: string;
  addLine: string;
  addArrow: string;
  kindLiterature: string;
  kindQuote: string;
  kindNote: string;
  emptyNote: string;
  badge: string;
  applyTemplate: string;
  chooseTemplate: string;
  saveAsTemplate: string;
  templateName: string;
  includeTemplateContent: string;
  customTemplates: string;
  noCustomTemplates: string;
  renameTemplate: string;
  duplicateTemplate: string;
  deleteTemplate: string;
  kindFrame: string;
  annotationColor: string;
  annotations: { one: string; other: string };
  sourceStatus: string;
  sourceIdle: string;
  sourceAvailable: string;
  sourceLoading: string;
  sourceMissing: string;
  attachmentNotDownloaded: string;
  acquisitionSummary: string;
  dropMalformed: string;
  dropUnsupported: string;
  acquisitionFailed: string;
  sourceOpenFailed: string;
  sourceRefreshFailed: string;
  noteRefreshFailed: string;
  failureLibraryMissing: string;
  failureItemMissing: string;
  failureWrongKind: string;
  failureParentMismatch: string;
  failureAttachmentUnavailable: string;
  failureAnnotationUnavailable: string;
  failureResolutionFailed: string;
  failureOpenFailed: string;
  failureListFailed: string;
  openSource: string;
  refreshSource: string;
  refreshNote: string;
  viewAnnotations: string;
  annotationBrowserTitle: string;
  searchAnnotations: string;
  annotationsLoading: string;
  annotationsEmpty: string;
  annotationsUnavailable: string;
  annotationsPartialFailure: string;
  annotationAlreadyAdded: string;
  focusExistingAnnotation: string;
  addSelectedAnnotations: string;
  annotationPage: string;
  noteOverwriteTitle: string;
  noteOverwriteBody: string;
  confirm: string;
  cancel: string;
  eraser: string;
  undo: string;
  redo: string;
  save: string;
  switchWindow: string;
  settings: string;
  editText: string;
  copy: string;
  delete: string;
  openItem: string;
  alignLeft: string;
  alignRight: string;
  alignTop: string;
  alignBottom: string;
  alignHorizontal: string;
  alignVertical: string;
  distributeHorizontal: string;
  distributeVertical: string;
  fitView: string;
  groupSelection: string;
  removeFromGroup: string;
  ungroup?: string;
  joinGroup?: string;
  groupLabel?: string;
  unnamedGroup?: string;
  groupMembers?: string;
  groupJoined?: string;
  noGroups?: string;
  quoteCreateClaim?: string;
  quoteCreateEvidence?: string;
  fitSelection: string;
  drawTools: string;
  selectionDetails: string;
  edgeLabel: string;
  edgeRelation: string;
  relationNone: string;
  relationRelated: string;
  relationSupports: string;
  relationContradicts: string;
  autoLayout: string;
  edgeColor: string;
  edgeDash: string;
  edgeArrow: string;
  edgeStyle: string;
  edgeArrows: string;
  arrowNone: string;
  arrowForward: string;
  arrowReverse: string;
  arrowBoth: string;
  edgeSelection: string;
  saved: string;
  saving: string;
  saveFailed: string;
  exportPng: string;
  exporting: string;
  exportRenderFailed: string;
  exportSvg: string;
  exportMarkdown: string;
  more: string;
  shortcutsTitle: string;
  close: string;
  stroke: string;
  background: string;
  transparent: string;
  style: string;
  batchStyle?: string;
  solid: string;
  dashed: string;
  corners: string;
  strokeWidth: string;
  geometry: string;
  nodeWidth: string;
  nodeHeight: string;
  positionX: string;
  positionY: string;
  format: string;
  color: string;
  size: string;
  alignment: string;
  textAlignment: string;
  verticalAlignment: string;
  fontSystem: string;
  fontGeorgia: string;
  fontTimes: string;
  fontInter: string;
  fontMenlo: string;
  fontSerifSc: string;
  weightRegular: string;
  textItalic: string;
  textUnderline: string;
  textStrike: string;
  fontFamily: string;
  fontDefault: string;
  weightBold: string;
  commonColors: string;
  opacity: string;
  customColor: string;
  resetColor: string;
  recentColors: string;
  shortcutSelect: string;
  shortcutHand: string;
  shortcutFreeMove?: string;
  shortcutNudge?: string;
  shortcutNudgeLarge?: string;
  shortcutRect: string;
  shortcutEllipse: string;
  shortcutArrow: string;
  shortcutLine: string;
  shortcutText: string;
  shortcutQuestion: string;
  shortcutClaim: string;
  shortcutFrame: string;
  shortcutEraser: string;
  shortcutConstrain: string;
  shortcutCancel: string;
  shortcutDelete: string;
  shortcutUndo: string;
  shortcutRedo: string;
}

export interface WhiteboardInitPayload {
  theme: WhiteboardTheme;
  editable?: boolean;
  colorScheme?: ColorSchemeID;
  appearance?: WhiteboardAppearance;
  snapshot?: CanvasDocument | null;
  labels?: WhiteboardLabels;
  templates?: NoteTemplate[];
}

export type AcademicSourceDescriptor =
  | { kind: "literature"; source: LiteratureSource }
  | { kind: "note"; source: NoteSource }
  | { kind: "quote"; source: QuoteSource }
  | { kind: "attachment"; source: AttachmentSource };

export type SourceResolutionPriority = "selected" | "visible" | "idle";

export type AcademicAcquisition =
  | {
      kind: "literature";
      source: LiteratureSource;
      snapshot: LiteratureSnapshot;
    }
  | {
      kind: "note";
      source: NoteSource;
      sourceSnapshot?: NoteSourceSnapshot;
      content: string;
    }
  | { kind: "quote"; source: QuoteSource; snapshot: QuoteSnapshot }
  | {
      kind: "attachment";
      source: AttachmentSource;
      snapshot: AttachmentSnapshot;
    };

export interface IndexedAcademicAcquisition {
  index: number;
  acquisition: AcademicAcquisition;
}

/** Ordered, persistence-safe identity used after the host resolves a Zotero drag. */
export type AcademicDropSourceRef = LiteratureSource | AttachmentSource;

export type AcademicDropFailureCode = "drop-malformed" | "drop-unsupported";

export type AcademicRequestFailureCode =
  | "picker-cancelled"
  | "picker-failed"
  | "acquisition-failed"
  | "library-missing"
  | "item-missing"
  | "wrong-kind"
  | "parent-mismatch"
  | "attachment-not-downloaded"
  | "note-refresh-failed";

export type AcademicAcquisitionFailureCode =
  | "item-missing"
  | "unsupported-attachment"
  | "unsupported-kind"
  | "attachment-not-downloaded"
  | "acquisition-failed";

export interface AcademicAcquisitionFailure {
  index: number;
  code: AcademicAcquisitionFailureCode;
  message: string;
}

export interface AcademicAcquisitionBatch {
  successes: IndexedAcademicAcquisition[];
  failures: AcademicAcquisitionFailure[];
}

export interface AcademicSourceActionFailure {
  code: AcademicSourceActionFailureCode;
  message: string;
}

export type AcademicIntegrityFailureCode =
  | "library-missing"
  | "item-missing"
  | "wrong-kind"
  | "parent-mismatch"
  | "attachment-not-downloaded";

export type AcademicSourceActionFailureCode =
  AcademicIntegrityFailureCode | "open-failed";

export type SourceResolutionFailureCode =
  AcademicIntegrityFailureCode | "resolution-failed";

export type SourceResolutionResult =
  | {
      nodeId: string;
      generation: number;
      status: "resolved";
      acquisition: AcademicAcquisition;
    }
  | {
      nodeId: string;
      generation: number;
      status: "unavailable";
      code: SourceResolutionFailureCode;
      message: string;
    };

export interface AnnotationCandidate {
  acquisition: Extract<AcademicAcquisition, { kind: "quote" }>;
  attachmentTitle: string;
  sortIndex: string;
}

export type AnnotationListFailureCode =
  | "library-missing"
  | "item-missing"
  | "wrong-kind"
  | "parent-mismatch"
  | "attachment-unavailable"
  | "annotation-unavailable"
  | "list-failed";

export interface AnnotationListFailure {
  code: AnnotationListFailureCode;
  message: string;
  attachmentKey?: string;
  annotationKey?: string;
}

export interface AnnotationListResult {
  candidates: AnnotationCandidate[];
  failures: AnnotationListFailure[];
}

export type CanvasFailureCode =
  | AcademicSourceActionFailureCode
  | SourceResolutionFailureCode
  | AnnotationListFailureCode
  | "note-refresh-failed";

export type CanvasNotice =
  | {
      code: "acquisition-summary";
      context: { successCount: number; failureCount: number };
    }
  | { code: AcademicDropFailureCode }
  | { code: "acquisition-failed" }
  | {
      code: "source-open-failed";
      nodeId: string;
      failureCode: AcademicSourceActionFailureCode;
    }
  | {
      code: "source-refresh-failed";
      nodeId: string;
      failureCode: SourceResolutionFailureCode;
    }
  | {
      code: "note-refresh-failed";
      nodeId: string;
      failureCode: AcademicIntegrityFailureCode | "note-refresh-failed";
    }
  | {
      code: "annotations-unavailable";
      requestId: string;
      failureCode: AnnotationListFailureCode;
    }
  | {
      code: "annotations-partial-failure";
      requestId: string;
      failureCodes: AnnotationListFailureCode[];
    };

export type ParentToWhiteboardMessage = WhiteboardProtocolMessage &
  (
    | { type: "init"; payload: WhiteboardInitPayload }
    | { type: "setTheme"; payload: { theme: WhiteboardTheme } }
    | { type: "setAppearance"; payload: { appearance: WhiteboardAppearance } }
    | { type: "setColorScheme"; payload: { colorScheme: ColorSchemeID } }
    | {
        type: "loadSnapshot";
        payload: { snapshot: CanvasDocument };
      }
    | { type: "requestSnapshot"; payload: { requestId: string } }
    | { type: "command"; payload: { command: WhiteboardCommand } }
    | { type: "focus" }
    | { type: "destroy" }
    | {
        type: "academicSourcesAcquired";
        payload: {
          requestId: string;
          nodeId: string;
          successes: IndexedAcademicAcquisition[];
          failures: AcademicAcquisitionFailure[];
        };
      }
    | {
        type: "academicDropStarted";
        payload: {
          requestId: string;
          nodeId: string;
          position: { x: number; y: number };
          sources: AcademicDropSourceRef[];
        };
      }
    | {
        type: "academicDropRejected";
        payload: { code: AcademicDropFailureCode };
      }
    | {
        type: "sourceResolutionBatch";
        payload: {
          requestId: string;
          generation: number;
          results: SourceResolutionResult[];
        };
      }
    | {
        type: "annotationsListed";
        payload: {
          requestId: string;
          source: LiteratureSource;
          candidates: AnnotationCandidate[];
          failures: AnnotationListFailure[];
        };
      }
    | {
        type: "annotationListFailed";
        payload: {
          requestId: string;
          source: LiteratureSource;
          failure: AnnotationListFailure;
        };
      }
    | {
        type: "noteRefreshed";
        payload: {
          requestId: string;
          nodeId: string;
          acquisition: Extract<AcademicAcquisition, { kind: "note" }>;
        };
      }
    | {
        type: "academicRequestFailed";
        payload: {
          requestId: string;
          nodeId: string;
          code: AcademicRequestFailureCode;
          diagnostic?: string;
        };
      }
    | {
        type: "sourceActionFailed";
        payload: {
          requestId: string;
          nodeId: string;
          source: AcademicSourceDescriptor;
          failure: AcademicSourceActionFailure;
        };
      }
    | {
        type: "sourceActionSucceeded";
        payload: {
          requestId: string;
          nodeId: string;
          action: "open";
          source: AcademicSourceDescriptor;
        };
      }
    | {
        type: "saveState";
        payload: { state: "saved" | "saving" | "error" };
      }
    | {
        type: "noteTemplatesChanged";
        payload: { templates: NoteTemplate[] };
      }
  );

export type WhiteboardToParentMessage = WhiteboardProtocolMessage &
  WhiteboardToParentBody;

/** The sender supplies only the body; the bridge owns the envelope. */
export type WhiteboardToParentBody =
  | { type: "ready" }
  | { type: "change"; payload: { rev: number } }
  | {
      type: "snapshot";
      payload: {
        requestId: string;
        rev: number;
        snapshot: CanvasDocument;
      };
    }
  | { type: "save" }
  | { type: "switchWindow" }
  | { type: "openSettings" }
  | { type: "openLink"; payload: { href: string } }
  | {
      type: "openFile";
      payload: { nodeId: string; attachmentId?: string };
    }
  | { type: "error"; payload: { message: string } }
  | {
      type: "openItem";
      payload: {
        itemID?: number;
        attachmentID?: number;
        pdfPage?: number;
      };
    }
  | {
      type: "pickAcademicSource";
      payload: {
        requestId: string;
        nodeId: string;
        kind: "literature";
      };
    }
  | {
      type: "dropAcademicSources";
      payload: {
        requestId: string;
        nodeId: string;
        sources: AcademicDropSourceRef[];
      };
    }
  | {
      type: "resolveAcademicSources";
      payload: {
        requestId: string;
        generation: number;
        priority: SourceResolutionPriority;
        sources: Array<{
          nodeId: string;
          source: AcademicSourceDescriptor;
          refresh?: boolean;
        }>;
      };
    }
  | {
      type: "listLiteratureAnnotations";
      payload: { requestId: string; source: LiteratureSource };
    }
  | {
      type: "refreshZoteroNote";
      payload: { requestId: string; nodeId: string; source: NoteSource };
    }
  | {
      type: "openAcademicSource";
      payload: {
        requestId: string;
        nodeId: string;
        source: AcademicSourceDescriptor;
      };
    }
  | {
      type: "exportFile";
      payload: {
        requestId: string;
        format: "png" | "svg" | "md";
        mimeType: string;
        dataUrl?: string;
        text?: string;
      };
    }
  | { type: "saveNoteTemplate"; payload: { template: NoteTemplate } }
  | { type: "deleteNoteTemplate"; payload: { templateId: string } };

type ActiveWhiteboardToParentType = WhiteboardToParentMessage["type"];
type ActiveParentToWhiteboardType = ParentToWhiteboardMessage["type"];

// These production maps make protocol growth fail typechecking until ingress
// explicitly classifies the new message arm.
const activeWhiteboardToParentTypes = {
  ready: true,
  change: true,
  snapshot: true,
  save: true,
  switchWindow: true,
  openSettings: true,
  error: true,
  pickAcademicSource: true,
  openLink: true,
  openFile: true,
  openItem: true,
  dropAcademicSources: true,
  resolveAcademicSources: true,
  listLiteratureAnnotations: true,
  refreshZoteroNote: true,
  openAcademicSource: true,
  exportFile: true,
  saveNoteTemplate: true,
  deleteNoteTemplate: true,
} satisfies Record<ActiveWhiteboardToParentType, true>;

const activeParentToWhiteboardTypes = {
  init: true,
  setTheme: true,
  setAppearance: true,
  setColorScheme: true,
  loadSnapshot: true,
  requestSnapshot: true,
  command: true,
  focus: true,
  destroy: true,
  academicSourcesAcquired: true,
  academicDropStarted: true,
  academicDropRejected: true,
  sourceResolutionBatch: true,
  annotationsListed: true,
  annotationListFailed: true,
  noteRefreshed: true,
  academicRequestFailed: true,
  sourceActionFailed: true,
  sourceActionSucceeded: true,
  saveState: true,
  noteTemplatesChanged: true,
} satisfies Record<ActiveParentToWhiteboardType, true>;

export function isWhiteboardProtocolMessage(
  data: unknown,
): data is WhiteboardProtocolMessage & { type: string } {
  return safelyValidate(() => {
    if (!isPlainRecord(data) || !isNonEmptyString(data.channel)) return false;
    return hasProtocolEnvelope(data, data.channel);
  });
}

export function isWhiteboardProtocolMessageForChannel(
  data: unknown,
  channel: string,
): data is WhiteboardProtocolMessage & { type: string } {
  return safelyValidate(
    () => isWhiteboardProtocolMessage(data) && data.channel === channel,
  );
}

type ProtocolRecord = Record<string, unknown>;

function safelyValidate(validate: () => boolean): boolean {
  try {
    return validate();
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is ProtocolRecord {
  if (!value || typeof value !== "object") return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null) {
      if (Object.getPrototypeOf(prototype) !== null) return false;
      const constructor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
      );
      const constructorName =
        constructor && "value" in constructor
          ? Object.getOwnPropertyDescriptor(constructor.value, "name")
          : undefined;
      const constructorPrototype =
        constructor && "value" in constructor
          ? Object.getOwnPropertyDescriptor(constructor.value, "prototype")
          : undefined;
      if (
        !constructor ||
        !("value" in constructor) ||
        typeof constructor.value !== "function" ||
        !constructorName ||
        !("value" in constructorName) ||
        constructorName.value !== "Object" ||
        !constructorPrototype ||
        !("value" in constructorPrototype) ||
        constructorPrototype.value !== prototype ||
        !isNativeObjectConstructor(constructor.value)
      ) {
        return false;
      }
    }
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && descriptor.enumerable && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function isNativeObjectConstructor(value: Function): boolean {
  return /^function Object\(\)\s*\{\s*\[native code\]\s*\}$/.test(
    Function.prototype.toString.call(value),
  );
}

function hasOwn(value: ProtocolRecord, key: string): boolean {
  return safelyValidate(() => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExactKeys(
  value: ProtocolRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return safelyValidate(() => {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return false;
    const allowed = new Set([...required, ...optional]);
    return (
      required.every((key) => hasOwn(value, key)) &&
      keys.every((key) => allowed.has(key as string))
    );
  });
}

function isArrayOf<T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): value is T[];
function isArrayOf(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is unknown[];
function isArrayOf(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is unknown[] {
  return safelyValidate(() => {
    if (!Array.isArray(value)) return false;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !("value" in length) || !Number.isSafeInteger(length.value))
      return false;
    if (Reflect.ownKeys(value).length !== length.value + 1) return false;
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        return false;
      if (!predicate(descriptor.value)) return false;
    }
    return true;
  });
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isWhiteboardAppearance(value: unknown): value is WhiteboardAppearance {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["fontFamily", "backgroundColor"]) &&
    (value.fontFamily === "system" ||
      value.fontFamily === "serif" ||
      value.fontFamily === "mono") &&
    (value.backgroundColor === "" ||
      (isString(value.backgroundColor) &&
        /^#[\da-f]{6}$/i.test(value.backgroundColor)))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalOwnString(value: ProtocolRecord, key: string): boolean {
  return hasOwn(value, key) ? isOptionalString(value[key]) : !(key in value);
}

function isOptionalPositiveInteger(
  value: unknown,
): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && (value as number) > 0)
  );
}

function isOptionalOwnPositiveInteger(
  value: ProtocolRecord,
  key: string,
): boolean {
  return hasOwn(value, key)
    ? isOptionalPositiveInteger(value[key])
    : !(key in value);
}

const whiteboardLabelStringKeys: Record<
  Exclude<keyof WhiteboardLabels, "annotations">,
  true
> = {
  searchCanvas: true,
  duplicateSelection: true,
  layoutAllConfirm: true,
  canvas: true,
  selection: true,
  select: true,
  hand: true,
  addItem: true,
  addNote: true,
  addQuestion: true,
  addClaim: true,
  addEvidence: true,
  addSummary: true,
  noteType: true,
  notePrompt: true,
  questionPrompt: true,
  claimPrompt: true,
  evidencePrompt: true,
  summaryPrompt: true,
  editNoteBody: true,
  addFrame: true,
  addPdf: true,
  addFile: true,
  attachFile: true,
  fileImage: true,
  filePdf: true,
  fileText: true,
  fileAudio: true,
  fileVideo: true,
  fileGeneric: true,
  fileOpen: true,
  fileDetails: true,
  filePreview: true,
  fileTooLarge: true,
  fileImportFailed: true,
  fileUnavailable: true,
  fileDimensions: true,
  filePages: true,
  addText: true,
  addRect: true,
  addRoundedRect: true,
  addDiamond: true,
  addEllipse: true,
  addLine: true,
  addArrow: true,
  kindLiterature: true,
  kindQuote: true,
  kindNote: true,
  emptyNote: true,
  badge: true,
  applyTemplate: true,
  chooseTemplate: true,
  saveAsTemplate: true,
  templateName: true,
  includeTemplateContent: true,
  customTemplates: true,
  noCustomTemplates: true,
  renameTemplate: true,
  duplicateTemplate: true,
  deleteTemplate: true,
  kindFrame: true,
  annotationColor: true,
  sourceStatus: true,
  sourceIdle: true,
  sourceAvailable: true,
  sourceLoading: true,
  sourceMissing: true,
  attachmentNotDownloaded: true,
  acquisitionSummary: true,
  dropMalformed: true,
  dropUnsupported: true,
  acquisitionFailed: true,
  sourceOpenFailed: true,
  sourceRefreshFailed: true,
  noteRefreshFailed: true,
  failureLibraryMissing: true,
  failureItemMissing: true,
  failureWrongKind: true,
  failureParentMismatch: true,
  failureAttachmentUnavailable: true,
  failureAnnotationUnavailable: true,
  failureResolutionFailed: true,
  failureOpenFailed: true,
  failureListFailed: true,
  openSource: true,
  refreshSource: true,
  refreshNote: true,
  viewAnnotations: true,
  annotationBrowserTitle: true,
  searchAnnotations: true,
  annotationsLoading: true,
  annotationsEmpty: true,
  annotationsUnavailable: true,
  annotationsPartialFailure: true,
  annotationAlreadyAdded: true,
  focusExistingAnnotation: true,
  addSelectedAnnotations: true,
  annotationPage: true,
  noteOverwriteTitle: true,
  noteOverwriteBody: true,
  confirm: true,
  cancel: true,
  eraser: true,
  undo: true,
  redo: true,
  save: true,
  switchWindow: true,
  settings: true,
  editText: true,
  copy: true,
  delete: true,
  openItem: true,
  alignLeft: true,
  alignRight: true,
  alignTop: true,
  alignBottom: true,
  alignHorizontal: true,
  alignVertical: true,
  distributeHorizontal: true,
  distributeVertical: true,
  fitView: true,
  groupSelection: true,
  removeFromGroup: true,
  ungroup: true,
  joinGroup: true,
  groupLabel: true,
  unnamedGroup: true,
  groupMembers: true,
  groupJoined: true,
  noGroups: true,
  quoteCreateClaim: true,
  quoteCreateEvidence: true,
  fitSelection: true,
  drawTools: true,
  selectionDetails: true,
  edgeLabel: true,
  edgeRelation: true,
  relationNone: true,
  relationRelated: true,
  relationSupports: true,
  relationContradicts: true,
  autoLayout: true,
  edgeColor: true,
  edgeDash: true,
  edgeArrow: true,
  edgeStyle: true,
  edgeArrows: true,
  arrowNone: true,
  arrowForward: true,
  arrowReverse: true,
  arrowBoth: true,
  edgeSelection: true,
  saved: true,
  saving: true,
  saveFailed: true,
  exportPng: true,
  exporting: true,
  exportRenderFailed: true,
  exportSvg: true,
  exportMarkdown: true,
  more: true,
  shortcutsTitle: true,
  close: true,
  stroke: true,
  background: true,
  transparent: true,
  style: true,
  batchStyle: true,
  solid: true,
  dashed: true,
  corners: true,
  strokeWidth: true,
  geometry: true,
  nodeWidth: true,
  nodeHeight: true,
  positionX: true,
  positionY: true,
  format: true,
  color: true,
  size: true,
  alignment: true,
  textAlignment: true,
  verticalAlignment: true,
  fontSystem: true,
  fontGeorgia: true,
  fontTimes: true,
  fontInter: true,
  fontMenlo: true,
  fontSerifSc: true,
  weightRegular: true,
  textItalic: true,
  textUnderline: true,
  textStrike: true,
  fontFamily: true,
  fontDefault: true,
  weightBold: true,
  commonColors: true,
  opacity: true,
  customColor: true,
  resetColor: true,
  recentColors: true,
  shortcutSelect: true,
  shortcutHand: true,
  shortcutFreeMove: true,
  shortcutNudge: true,
  shortcutNudgeLarge: true,
  shortcutRect: true,
  shortcutEllipse: true,
  shortcutArrow: true,
  shortcutLine: true,
  shortcutText: true,
  shortcutQuestion: true,
  shortcutClaim: true,
  shortcutFrame: true,
  shortcutEraser: true,
  shortcutConstrain: true,
  shortcutCancel: true,
  shortcutDelete: true,
  shortcutUndo: true,
  shortcutRedo: true,
};

function isWhiteboardLabels(value: unknown): value is WhiteboardLabels {
  if (!isPlainRecord(value)) return false;
  const optional = [
    "searchCanvas",
    "duplicateSelection",
    "layoutAllConfirm",
    "batchStyle",
    "ungroup",
    "joinGroup",
    "groupLabel",
    "unnamedGroup",
    "groupMembers",
    "groupJoined",
    "noGroups",
    "quoteCreateClaim",
    "quoteCreateEvidence",
    "shortcutFreeMove",
    "shortcutNudge",
    "shortcutNudgeLarge",
  ];
  const stringKeys = Object.keys(whiteboardLabelStringKeys).filter(
    (key) => !optional.includes(key),
  );
  if (!hasExactKeys(value, [...stringKeys, "annotations"], optional))
    return false;
  if (
    !optional.every((key) => value[key] === undefined || isString(value[key]))
  )
    return false;
  if (!stringKeys.every((key) => isString(value[key]))) return false;
  return (
    isPlainRecord(value.annotations) &&
    hasExactKeys(value.annotations, ["one", "other"]) &&
    isString(value.annotations.one) &&
    isString(value.annotations.other)
  );
}

/**
 * File parsing owns the Academic field rules. The wire additionally requires
 * plain own data and rejects anything the parser would normalize or discard.
 * Optional wire fields may explicitly be undefined; JSON omits those fields.
 */
function matchesParsedAcademicFields(
  value: unknown,
  parse: (value: unknown) => unknown,
  optional: readonly string[] = [],
): boolean {
  // Validate the data shape before parsing so accessors or sparse arrays
  // cannot execute code while a parser reads fields or copies an array.
  if (!isPlainRecord(value) || !hasSameDataShape(value, value)) return false;
  const input = Object.assign(Object.create(null), value) as ProtocolRecord;
  for (const key of optional) {
    if (!hasOwn(value, key) && key in value) return false;
    if (input[key] === undefined) delete input[key];
  }
  const parsed = parse(input);
  return parsed !== undefined && hasSameDataShape(input, parsed);
}

function isLiteratureSource(value: unknown): boolean {
  return matchesParsedAcademicFields(value, parseLiteratureSource);
}

function isNoteSource(value: unknown): boolean {
  return matchesParsedAcademicFields(value, parseNoteSource, ["itemKey"]);
}

function isQuoteSource(value: unknown): boolean {
  return matchesParsedAcademicFields(value, parseQuoteSource);
}

function isAcademicSourceDescriptor(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (!hasExactKeys(value, ["kind", "source"])) return false;
  if (value.kind === "literature") return isLiteratureSource(value.source);
  if (value.kind === "note") return isNoteSource(value.source);
  if (value.kind === "quote") return isQuoteSource(value.source);
  if (value.kind === "attachment") return isAttachmentSource(value.source);
  return false;
}

function isAttachmentSource(value: unknown): value is AttachmentSource {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["library", "attachmentKey"]) &&
    isLibraryRefShape(value.library) &&
    isNonEmptyString(value.attachmentKey)
  );
}

function isLibraryRefShape(value: unknown): boolean {
  if (!isPlainRecord(value) || !hasOwn(value, "type")) return false;
  if (value.type === "user") return hasExactKeys(value, ["type"]);
  return (
    value.type === "group" &&
    hasExactKeys(value, ["type", "groupID"]) &&
    Number.isSafeInteger(value.groupID) &&
    (value.groupID as number) > 0
  );
}

function isAttachmentSnapshot(value: unknown): value is AttachmentSnapshot {
  return (
    isPlainRecord(value) &&
    hasExactKeys(
      value,
      ["filename", "availability"],
      ["contentType", "title"],
    ) &&
    isNonEmptyString(value.filename) &&
    isOptionalOwnString(value, "title") &&
    (value.availability === "available" ||
      value.availability === "not-downloaded") &&
    isOptionalOwnString(value, "contentType")
  );
}

function isAcademicDropSource(value: unknown): value is AcademicDropSourceRef {
  return isLiteratureSource(value) || isAttachmentSource(value);
}

function isLiteratureSnapshot(value: unknown): boolean {
  return matchesParsedAcademicFields(value, parseLiteratureSnapshot, [
    "creators",
    "year",
    "publicationTitle",
    "tags",
    "annotationCount",
  ]);
}

function isQuoteSnapshot(value: unknown): boolean {
  return matchesParsedAcademicFields(value, parseQuoteSnapshot, [
    "comment",
    "citation",
    "pageLabel",
    "color",
  ]);
}

function isAcademicAcquisition(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "literature") {
    return (
      hasExactKeys(value, ["kind", "source", "snapshot"]) &&
      isLiteratureSource(value.source) &&
      isLiteratureSnapshot(value.snapshot)
    );
  }
  if (value.kind === "quote") {
    return (
      hasExactKeys(value, ["kind", "source", "snapshot"]) &&
      isQuoteSource(value.source) &&
      isQuoteSnapshot(value.snapshot)
    );
  }
  if (value.kind === "attachment") {
    return (
      hasExactKeys(value, ["kind", "source", "snapshot"]) &&
      isAttachmentSource(value.source) &&
      isAttachmentSnapshot(value.snapshot)
    );
  }
  return (
    value.kind === "note" &&
    hasExactKeys(value, ["kind", "source", "content"], ["sourceSnapshot"]) &&
    isNoteSource(value.source) &&
    isString(value.content) &&
    (hasOwn(value, "sourceSnapshot")
      ? value.sourceSnapshot === undefined ||
        matchesParsedAcademicFields(
          value.sourceSnapshot,
          parseNoteSourceSnapshot,
          ["title"],
        )
      : !("sourceSnapshot" in value))
  );
}

function isCanvasDocument(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  try {
    const parsed = parseCanvasDocument(value);
    return (
      parsed.issues.length === 0 && hasSameDataShape(value, parsed.document)
    );
  } catch {
    return false;
  }
}

function hasSameDataShape(left: unknown, right: unknown): boolean {
  return safelyValidate(() => hasSameDataShapeUnchecked(left, right));
}

function hasSameDataShapeUnchecked(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (left === undefined || right === undefined) return left === right;
  if (typeof left !== typeof right) return false;
  if (
    typeof left === "string" ||
    typeof left === "boolean" ||
    typeof left === "number"
  ) {
    return (
      Object.is(left, right) &&
      (typeof left !== "number" || Number.isFinite(left))
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!isArrayOf(left, () => true) || !isArrayOf(right, () => true))
      return false;
    const leftLength = Object.getOwnPropertyDescriptor(left, "length")?.value;
    const rightLength = Object.getOwnPropertyDescriptor(right, "length")?.value;
    if (!Number.isSafeInteger(leftLength) || leftLength !== rightLength)
      return false;
    for (let index = 0; index < (leftLength as number); index += 1) {
      const leftEntry = Object.getOwnPropertyDescriptor(
        left,
        String(index),
      )?.value;
      const rightEntry = Object.getOwnPropertyDescriptor(
        right,
        String(index),
      )?.value;
      if (!hasSameDataShape(leftEntry, rightEntry)) return false;
    }
    return true;
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        typeof key === "string" &&
        hasOwn(right, key) &&
        hasSameDataShape(left[key], right[key]),
    )
  );
}

function isAcademicSourceRequest(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["nodeId", "source"], ["refresh"]) &&
    isNonEmptyString(value.nodeId) &&
    isAcademicSourceDescriptor(value.source) &&
    (hasOwn(value, "refresh")
      ? value.refresh === undefined || typeof value.refresh === "boolean"
      : !("refresh" in value))
  );
}

const acquisitionFailureCodes: Record<AcademicAcquisitionFailureCode, true> = {
  "item-missing": true,
  "unsupported-attachment": true,
  "unsupported-kind": true,
  "attachment-not-downloaded": true,
  "acquisition-failed": true,
};
const requestFailureCodes: Record<AcademicRequestFailureCode, true> = {
  "picker-cancelled": true,
  "picker-failed": true,
  "acquisition-failed": true,
  "library-missing": true,
  "item-missing": true,
  "wrong-kind": true,
  "parent-mismatch": true,
  "attachment-not-downloaded": true,
  "note-refresh-failed": true,
};
const sourceActionFailureCodes: Record<AcademicSourceActionFailureCode, true> =
  {
    "library-missing": true,
    "item-missing": true,
    "wrong-kind": true,
    "parent-mismatch": true,
    "attachment-not-downloaded": true,
    "open-failed": true,
  };
const resolutionFailureCodes: Record<SourceResolutionFailureCode, true> = {
  "library-missing": true,
  "item-missing": true,
  "wrong-kind": true,
  "parent-mismatch": true,
  "attachment-not-downloaded": true,
  "resolution-failed": true,
};
const annotationFailureCodes: Record<AnnotationListFailureCode, true> = {
  "library-missing": true,
  "item-missing": true,
  "wrong-kind": true,
  "parent-mismatch": true,
  "attachment-unavailable": true,
  "annotation-unavailable": true,
  "list-failed": true,
};

function hasFiniteCode<Code extends string>(
  codes: Readonly<Record<Code, true>>,
  value: unknown,
): value is Code {
  return isString(value) && hasOwn(codes, value);
}

function isFailureWithCode(
  value: unknown,
  codes: Readonly<Record<string, true>>,
  optional: readonly string[] = [],
): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["code", "message"], optional) &&
    hasFiniteCode(codes, value.code) &&
    isString(value.message)
  );
}

function isIndexedAcquisition(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["index", "acquisition"]) &&
    Number.isSafeInteger(value.index) &&
    (value.index as number) >= 0 &&
    isAcademicAcquisition(value.acquisition)
  );
}

function isAcquisitionFailure(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return (
    hasExactKeys(value, ["index", "code", "message"]) &&
    hasFiniteCode(acquisitionFailureCodes, value.code) &&
    isString(value.message) &&
    Number.isSafeInteger(value.index) &&
    (value.index as number) >= 0
  );
}

function isSourceActionFailure(value: unknown): boolean {
  return isFailureWithCode(value, sourceActionFailureCodes);
}

function isResolutionResult(value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    !isNonEmptyString(value.nodeId) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0
  ) {
    return false;
  }
  if (value.status === "resolved") {
    return (
      hasExactKeys(value, ["nodeId", "generation", "status", "acquisition"]) &&
      isAcademicAcquisition(value.acquisition)
    );
  }
  return (
    hasExactKeys(value, [
      "nodeId",
      "generation",
      "status",
      "code",
      "message",
    ]) &&
    value.status === "unavailable" &&
    hasFiniteCode(resolutionFailureCodes, value.code) &&
    isString(value.message)
  );
}

function isAnnotationFailure(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return (
    isFailureWithCode(value, annotationFailureCodes, [
      "attachmentKey",
      "annotationKey",
    ]) &&
    isOptionalOwnString(value, "attachmentKey") &&
    isOptionalOwnString(value, "annotationKey")
  );
}

function isAnnotationCandidate(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["acquisition", "attachmentTitle", "sortIndex"]) &&
    isNonEmptyString(value.attachmentTitle) &&
    isString(value.sortIndex) &&
    isPlainRecord(value.acquisition) &&
    value.acquisition.kind === "quote" &&
    isAcademicAcquisition(value.acquisition)
  );
}

function isNoteTemplate(value: unknown): value is NoteTemplate {
  if (!isPlainRecord(value)) return false;
  const parsed = parseNoteTemplate(value);
  return Boolean(parsed && hasSameDataShape(value, parsed));
}

function hasRequestAndNode(payload: ProtocolRecord): boolean {
  return (
    isNonEmptyString(payload.requestId) && isNonEmptyString(payload.nodeId)
  );
}

function hasProtocolEnvelope(
  data: unknown,
  channel: string,
): data is ProtocolRecord {
  return safelyValidate(
    () =>
      isPlainRecord(data) &&
      !(!hasOwn(data, "payload") && "payload" in data) &&
      hasExactKeys(data, ["source", "channel", "v", "type"], ["payload"]) &&
      data.source === WHITEBOARD_MESSAGE_SOURCE &&
      data.channel === channel &&
      data.v === WHITEBOARD_PROTOCOL_VERSION &&
      isNonEmptyString(data.type),
  );
}

/** Closed runtime validator for messages handled by the Zotero host. */
function validateWhiteboardToParentMessageForChannel(
  data: unknown,
  channel: string,
): boolean {
  if (!hasProtocolEnvelope(data, channel)) return false;
  const payload = data.payload;
  const type = data.type;
  if (!hasFiniteCode(activeWhiteboardToParentTypes, type)) return false;
  switch (type) {
    case "ready":
    case "save":
    case "switchWindow":
    case "openSettings":
      return !hasOwn(data, "payload");
    case "change":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["rev"]) &&
        Number.isSafeInteger(payload.rev) &&
        (payload.rev as number) >= 0
      );
    case "snapshot":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "rev", "snapshot"]) &&
        isNonEmptyString(payload.requestId) &&
        Number.isSafeInteger(payload.rev) &&
        (payload.rev as number) >= 0 &&
        isCanvasDocument(payload.snapshot)
      );
    case "error":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["message"]) &&
        isString(payload.message)
      );
    case "pickAcademicSource":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "kind"]) &&
        hasRequestAndNode(payload) &&
        payload.kind === "literature"
      );
    case "openLink":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["href"]) &&
        isString(payload.href) &&
        payload.href.length < 8192
      );
    case "openFile":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["nodeId"], ["attachmentId"]) &&
        isNonEmptyString(payload.nodeId) &&
        (!hasOwn(payload, "attachmentId") ||
          isNonEmptyString(payload.attachmentId))
      );
    case "openItem":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, [], ["itemID", "attachmentID", "pdfPage"]) &&
        isOptionalOwnPositiveInteger(payload, "itemID") &&
        isOptionalOwnPositiveInteger(payload, "attachmentID") &&
        isOptionalOwnPositiveInteger(payload, "pdfPage")
      );
    case "dropAcademicSources":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "sources"]) &&
        hasRequestAndNode(payload) &&
        isArrayOf(payload.sources, isAcademicDropSource)
      );
    case "resolveAcademicSources":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, [
          "requestId",
          "generation",
          "priority",
          "sources",
        ]) &&
        isNonEmptyString(payload.requestId) &&
        Number.isSafeInteger(payload.generation) &&
        (payload.generation as number) >= 0 &&
        (payload.priority === "selected" ||
          payload.priority === "visible" ||
          payload.priority === "idle") &&
        isArrayOf(payload.sources, isAcademicSourceRequest)
      );
    case "listLiteratureAnnotations":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "source"]) &&
        isNonEmptyString(payload.requestId) &&
        isLiteratureSource(payload.source)
      );
    case "refreshZoteroNote":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "source"]) &&
        hasRequestAndNode(payload) &&
        isNoteSource(payload.source)
      );
    case "openAcademicSource":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "source"]) &&
        hasRequestAndNode(payload) &&
        isAcademicSourceDescriptor(payload.source)
      );
    case "exportFile":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(
          payload,
          ["requestId", "format", "mimeType"],
          ["dataUrl", "text"],
        ) &&
        isNonEmptyString(payload.requestId) &&
        (payload.format === "png" ||
          payload.format === "svg" ||
          payload.format === "md") &&
        isNonEmptyString(payload.mimeType) &&
        isOptionalOwnString(payload, "dataUrl") &&
        isOptionalOwnString(payload, "text")
      );
    case "saveNoteTemplate":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["template"]) &&
        isNoteTemplate(payload.template)
      );
    case "deleteNoteTemplate":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["templateId"]) &&
        isNonEmptyString(payload.templateId)
      );
    default:
      return rejectUnhandledProtocolType(type);
  }
}

export function isWhiteboardToParentMessageForChannel(
  data: unknown,
  channel: string,
): data is WhiteboardToParentMessage {
  return safelyValidate(() =>
    validateWhiteboardToParentMessageForChannel(data, channel),
  );
}

/** Closed runtime validator for messages handled by the whiteboard iframe. */
function validateParentToWhiteboardMessageForChannel(
  data: unknown,
  channel: string,
): boolean {
  if (!hasProtocolEnvelope(data, channel)) return false;
  const payload = data.payload;
  const type = data.type;
  if (!hasFiniteCode(activeParentToWhiteboardTypes, type)) return false;
  switch (type) {
    case "focus":
    case "destroy":
      return !hasOwn(data, "payload");
    case "init":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(
          payload,
          ["theme"],
          [
            "snapshot",
            "labels",
            "templates",
            "colorScheme",
            "appearance",
            "editable",
          ],
        ) &&
        (payload.theme === "light" || payload.theme === "dark") &&
        (!hasOwn(payload, "editable") ||
          payload.editable === undefined ||
          typeof payload.editable === "boolean") &&
        (!hasOwn(payload, "colorScheme") ||
          payload.colorScheme === undefined ||
          payload.colorScheme === "traditional" ||
          payload.colorScheme === "classic") &&
        (!hasOwn(payload, "appearance") ||
          payload.appearance === undefined ||
          isWhiteboardAppearance(payload.appearance)) &&
        (hasOwn(payload, "snapshot")
          ? payload.snapshot === undefined ||
            payload.snapshot === null ||
            isCanvasDocument(payload.snapshot)
          : !("snapshot" in payload)) &&
        (hasOwn(payload, "labels")
          ? payload.labels === undefined || isWhiteboardLabels(payload.labels)
          : !("labels" in payload)) &&
        (hasOwn(payload, "templates")
          ? payload.templates === undefined ||
            isArrayOf(payload.templates, isNoteTemplate)
          : !("templates" in payload))
      );
    case "setColorScheme":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["colorScheme"]) &&
        (payload.colorScheme === "traditional" ||
          payload.colorScheme === "classic")
      );
    case "setTheme":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["theme"]) &&
        (payload.theme === "light" || payload.theme === "dark")
      );
    case "setAppearance":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["appearance"]) &&
        isWhiteboardAppearance(payload.appearance)
      );
    case "loadSnapshot":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["snapshot"]) &&
        isCanvasDocument(payload.snapshot)
      );
    case "requestSnapshot":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId"]) &&
        isNonEmptyString(payload.requestId)
      );
    case "command":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["command"]) &&
        (payload.command === "undo" || payload.command === "redo")
      );
    case "saveState":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["state"]) &&
        (payload.state === "saved" ||
          payload.state === "saving" ||
          payload.state === "error")
      );
    case "noteTemplatesChanged":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["templates"]) &&
        isArrayOf(payload.templates, isNoteTemplate)
      );
    case "academicDropStarted":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "position", "sources"]) &&
        hasRequestAndNode(payload) &&
        isPlainRecord(payload.position) &&
        hasExactKeys(payload.position, ["x", "y"]) &&
        isFiniteNumber(payload.position.x) &&
        isFiniteNumber(payload.position.y) &&
        isArrayOf(payload.sources, isAcademicDropSource)
      );
    case "academicDropRejected":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["code"]) &&
        (payload.code === "drop-malformed" ||
          payload.code === "drop-unsupported")
      );
    case "academicSourcesAcquired":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, [
          "requestId",
          "nodeId",
          "successes",
          "failures",
        ]) &&
        hasRequestAndNode(payload) &&
        isArrayOf(payload.successes, isIndexedAcquisition) &&
        isArrayOf(payload.failures, isAcquisitionFailure)
      );
    case "academicRequestFailed":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(
          payload,
          ["requestId", "nodeId", "code"],
          ["diagnostic"],
        ) &&
        hasRequestAndNode(payload) &&
        hasFiniteCode(requestFailureCodes, payload.code) &&
        isOptionalOwnString(payload, "diagnostic")
      );
    case "sourceActionFailed":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "source", "failure"]) &&
        hasRequestAndNode(payload) &&
        isAcademicSourceDescriptor(payload.source) &&
        isSourceActionFailure(payload.failure)
      );
    case "sourceActionSucceeded":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "action", "source"]) &&
        hasRequestAndNode(payload) &&
        payload.action === "open" &&
        isAcademicSourceDescriptor(payload.source)
      );
    case "sourceResolutionBatch":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "generation", "results"]) &&
        isNonEmptyString(payload.requestId) &&
        Number.isSafeInteger(payload.generation) &&
        (payload.generation as number) >= 0 &&
        isArrayOf(payload.results, isResolutionResult)
      );
    case "annotationsListed":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, [
          "requestId",
          "source",
          "candidates",
          "failures",
        ]) &&
        isNonEmptyString(payload.requestId) &&
        isLiteratureSource(payload.source) &&
        isArrayOf(payload.candidates, isAnnotationCandidate) &&
        isArrayOf(payload.failures, isAnnotationFailure)
      );
    case "annotationListFailed":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "source", "failure"]) &&
        isNonEmptyString(payload.requestId) &&
        isLiteratureSource(payload.source) &&
        isAnnotationFailure(payload.failure)
      );
    case "noteRefreshed":
      return (
        hasOwn(data, "payload") &&
        isPlainRecord(payload) &&
        hasExactKeys(payload, ["requestId", "nodeId", "acquisition"]) &&
        hasRequestAndNode(payload) &&
        isPlainRecord(payload.acquisition) &&
        payload.acquisition.kind === "note" &&
        isAcademicAcquisition(payload.acquisition)
      );
    default:
      return rejectUnhandledProtocolType(type);
  }
}

export function isParentToWhiteboardMessageForChannel(
  data: unknown,
  channel: string,
): data is ParentToWhiteboardMessage {
  return safelyValidate(() =>
    validateParentToWhiteboardMessageForChannel(data, channel),
  );
}

function rejectUnhandledProtocolType(_type: never): false {
  return false;
}

type WhiteboardMessageEvent = Pick<MessageEvent, "data" | "source">;

interface SnapshottedWhiteboardMessageEvent {
  data: unknown;
  source: MessageEventSource | null;
}

function snapshotWhiteboardMessageEvent(
  event: WhiteboardMessageEvent,
): SnapshottedWhiteboardMessageEvent | undefined {
  try {
    const source = event.source;
    const liveData = event.data;
    if (!hasOnlyOwnCloneSafeData(liveData)) return undefined;
    const platformClone = globalThis.structuredClone;
    const data =
      typeof platformClone === "function"
        ? platformClone.call(globalThis, liveData)
        : cloneOwnProtocolData(liveData);
    return { data, source };
  } catch {
    return undefined;
  }
}

function hasOnlyOwnCloneSafeData(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return false;
      if (!hasOnlyOwnCloneSafeData(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function cloneOwnProtocolData(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;
  const array = Array.isArray(value);
  const clone = array
    ? new Array(
        (Object.getOwnPropertyDescriptor(value, "length")?.value as number) ??
          0,
      )
    : Object.create(
        Object.getPrototypeOf(value) === null ? null : Object.prototype,
      );
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Protocol data must contain only own data fields.");
    }
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: cloneOwnProtocolData(descriptor.value, seen),
      writable: true,
    });
  }
  return clone;
}

function isExpectedPeerSource(
  source: MessageEventSource | null,
  peer: MessageEventSource | null,
): boolean {
  // Zotero chrome can strip MessageEvent.source in both bridge directions.
  // The exact per-tab channel and closed schema are validated before this
  // narrow null exception. Non-null sources must retain object identity.
  return peer !== null && (source === null || source === peer);
}

export function readWhiteboardToParentMessageEvent(
  event: WhiteboardMessageEvent,
  peer: MessageEventSource | null,
  channel: string,
): WhiteboardToParentMessage | undefined {
  const snapshot = snapshotWhiteboardMessageEvent(event);
  if (
    !snapshot ||
    !isWhiteboardToParentMessageForChannel(snapshot.data, channel) ||
    !isExpectedPeerSource(snapshot.source, peer)
  ) {
    return undefined;
  }
  return snapshot.data;
}

export function readParentToWhiteboardMessageEvent(
  event: WhiteboardMessageEvent,
  peer: MessageEventSource | null,
  channel: string,
): ParentToWhiteboardMessage | undefined {
  const snapshot = snapshotWhiteboardMessageEvent(event);
  if (
    !snapshot ||
    !isParentToWhiteboardMessageForChannel(snapshot.data, channel) ||
    !isExpectedPeerSource(snapshot.source, peer)
  ) {
    return undefined;
  }
  return snapshot.data;
}

export function dispatchWhiteboardParentMessageEvent(
  event: WhiteboardMessageEvent,
  peer: MessageEventSource | null,
  channel: string,
  accept: (message: ParentToWhiteboardMessage) => void,
): boolean {
  const message = readParentToWhiteboardMessageEvent(event, peer, channel);
  if (!message) return false;
  accept(message);
  return true;
}

export function whiteboardChannel(tabID: string, canvasId: string) {
  return `${tabID}:${canvasId}`;
}
