import {
  createAcademicNode,
  isNoteType,
  literatureSourceIdentity,
  type CanvasNode,
  type NoteReference,
  type NoteType,
  type QuoteNode,
} from "../model/academic";
import type { BasicConnection, ConnectionSide } from "../model/connection";
import type { CanvasPoint } from "../model/core";
import type { CanvasDocument } from "../model/document";
import { changeNoteType } from "../model/note-template";

export interface ConnectedNoteOptions {
  originId: string;
  nodeId: string;
  edgeId: string;
  position: CanvasPoint;
  handleId?: string | null;
  handleType?: "source" | "target";
  noteType?: NoteType;
}

export interface NoteContinuation {
  document: CanvasDocument;
  noteId: string;
}

/** Add a note and its ordinary connection as one immutable document change. */
export function createConnectedNote(
  document: CanvasDocument,
  options: ConnectedNoteOptions,
): NoteContinuation | null {
  const origin = document.nodes.find((node) => node.id === options.originId);
  if (
    !origin ||
    origin.kind === "frame" ||
    !validNewIds(document, options.nodeId, options.edgeId) ||
    !Number.isFinite(options.position.x) ||
    !Number.isFinite(options.position.y) ||
    (options.noteType !== undefined && !isNoteType(options.noteType)) ||
    (options.handleType !== undefined &&
      options.handleType !== "source" &&
      options.handleType !== "target") ||
    (options.handleId !== undefined &&
      options.handleId !== null &&
      typeof options.handleId !== "string")
  ) {
    return null;
  }

  const blank = createAcademicNode(
    "note",
    { ...options.position },
    options.nodeId,
  );
  const note = options.noteType
    ? changeNoteType(blank, options.noteType)
    : blank;
  const noteHandle = facingSide(note, origin);
  const originHandle =
    options.handleId === undefined
      ? facingSide(origin, note)
      : options.handleId;
  const fromTarget = options.handleType === "target";
  const edge: BasicConnection = {
    id: options.edgeId,
    kind: "basic",
    source: fromTarget ? note.id : origin.id,
    target: fromTarget ? origin.id : note.id,
    sourceHandle: fromTarget ? noteHandle : originHandle,
    targetHandle: fromTarget ? originHandle : noteHandle,
  };
  return {
    document: {
      ...document,
      nodes: [...document.nodes, note],
      connections: [...document.connections, edge],
    },
    noteId: note.id,
  };
}

export interface QuoteNoteOptions {
  originId: string;
  nodeId: string;
  edgeId: string;
  position: CanvasPoint;
  noteType: "claim" | "evidence";
}

/** Keep the quote visible and link the new writing card to its Zotero item. */
export function createNoteFromQuote(
  document: CanvasDocument,
  options: QuoteNoteOptions,
): NoteContinuation | null {
  const quote = document.nodes.find((node) => node.id === options.originId);
  if (
    quote?.kind !== "quote" ||
    (options.noteType !== "claim" && options.noteType !== "evidence")
  ) {
    return null;
  }
  const result = createConnectedNote(document, options);
  if (!result) return null;
  const reference = quoteLiteratureReference(document, quote, options.nodeId);
  return {
    ...result,
    document: {
      ...result.document,
      nodes: result.document.nodes.map((node) =>
        node.id === result.noteId && node.kind === "note"
          ? { ...node, references: [reference] }
          : node,
      ),
    },
  };
}

function validNewIds(
  document: CanvasDocument,
  nodeId: string,
  edgeId: string,
): boolean {
  if (!nodeId || !edgeId || nodeId === edgeId) return false;
  return (
    document.nodes.every((node) => node.id !== nodeId && node.id !== edgeId) &&
    document.connections.every(
      (edge) => edge.id !== nodeId && edge.id !== edgeId,
    )
  );
}

function facingSide(from: CanvasNode, to: CanvasNode): ConnectionSide {
  const dx = to.position.x + to.width / 2 - (from.position.x + from.width / 2);
  const dy =
    to.position.y + to.height / 2 - (from.position.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function quoteLiteratureReference(
  document: CanvasDocument,
  quote: QuoteNode,
  noteId: string,
): NoteReference {
  const identity = literatureSourceIdentity(quote.source);
  const literature = document.nodes.find(
    (node) =>
      node.kind === "literature" &&
      literatureSourceIdentity(node.source) === identity,
  );
  const snapshot =
    literature?.kind === "literature" ? literature.snapshot : null;
  return {
    id: `reference-${noteId}`,
    kind: "literature",
    source: {
      library: { ...quote.source.library },
      itemKey: quote.source.itemKey,
    },
    title: (
      snapshot?.title ||
      quote.snapshot.citation ||
      quote.source.itemKey
    ).slice(0, 4096),
    ...(snapshot?.creators ? { creators: snapshot.creators } : {}),
    ...(snapshot?.year ? { year: snapshot.year } : {}),
  };
}
