import {
  applyNodeChanges,
  MarkerType,
  type NodeChange,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import type { CSSProperties } from "react";
import {
  effectiveCanvasNodeTextStyle,
  type CanvasNode,
} from "../model/academic";
import type {
  CanvasConnection,
  CanvasConnectionBase,
} from "../model/connection";
import type { CanvasNodeStyle } from "../model/core";
import type { CanvasDocument } from "../model/document";
import type { SourceResolutionResult } from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";
import {
  applyResolvedAcquisition,
  applyResolvedAcquisitionToCanvasNode,
} from "./sourceState";

export interface CanvasFlowEdgeData extends Record<string, unknown> {
  connection: CanvasConnection;
}

export type CanvasFlowEdge = Edge<CanvasFlowEdgeData>;

export interface CanvasDocumentShell {
  metadata?: CanvasDocument["metadata"];
  extensions?: CanvasDocument["extensions"];
}

export interface CanvasFlowDocument {
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  shell: CanvasDocumentShell;
}

export function nodeTextStyle(style: Partial<CanvasNodeStyle>): CSSProperties {
  return {
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
    ...(style.fontStyle !== undefined ? { fontStyle: style.fontStyle } : {}),
    ...(style.textDecoration !== undefined
      ? { textDecoration: style.textDecoration }
      : {}),
    ...(style.textAlign !== undefined ? { textAlign: style.textAlign } : {}),
    ...(style.textColor !== undefined ? { color: style.textColor } : {}),
    ...(style.textOpacity !== undefined ? { opacity: style.textOpacity } : {}),
  };
}

export function labelTextStyle(style: Partial<CanvasNodeStyle>): CSSProperties {
  return {
    fontFamily:
      style.fontFamily || "var(--zmd-board-font-family, system-ui, sans-serif)",
    fontSize: style.fontSize || 16,
    fontWeight: style.fontWeight || "normal",
    fontStyle: style.fontStyle || "normal",
    textDecoration: style.textDecoration || "none",
    textAlign: style.textAlign || "center",
    color: style.textColor ?? "var(--zmd-board-text, #111827)",
    opacity: style.textOpacity ?? 1,
    lineHeight: 1.25,
    width: "100%",
    display: "block",
    ...nodeTextStyle(style),
  };
}

export function verticalAlignmentStyle(
  style: Partial<CanvasNodeStyle>,
): CSSProperties {
  const alignment = style.verticalAlign || "middle";
  return {
    alignItems:
      alignment === "top"
        ? "flex-start"
        : alignment === "bottom"
          ? "flex-end"
          : "center",
  };
}

export function canvasDocumentToFlow(
  document: CanvasDocument,
): CanvasFlowDocument {
  return {
    nodes: document.nodes.map((model) => ({
      id: model.id,
      type: model.kind,
      position: model.position,
      data: { model },
      width: model.width,
      height: model.height,
      style: { width: model.width, height: model.height },
    })),
    edges: document.connections.map((connection) => {
      const color = connection.color ?? "#9ca3af";
      return {
        id: connection.id,
        source: connection.source,
        target: connection.target,
        // Older documents used unnamed right-to-left handles.
        sourceHandle: connection.sourceHandle ?? "right",
        targetHandle: connection.targetHandle ?? "left",
        label: connection.label,
        data: { connection },
        style: {
          stroke: color,
          strokeDasharray: connection.dashed ? "6 4" : undefined,
        },
        markerEnd:
          connection.arrow === false
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color,
              },
        markerStart:
          connection.startArrow === true
            ? {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color,
              }
            : undefined,
      };
    }),
    shell: {
      ...(document.metadata ? { metadata: document.metadata } : {}),
      ...(document.extensions ? { extensions: document.extensions } : {}),
    },
  };
}

export function flowToCanvasDocument(
  nodes: CanvasFlowNode[],
  edges: CanvasFlowEdge[],
  viewport: Viewport,
  shell: CanvasDocumentShell = {},
): CanvasDocument {
  return omitUndefinedRecordFields({
    version: 2,
    viewport,
    ...(shell.metadata ? { metadata: shell.metadata } : {}),
    ...(shell.extensions ? { extensions: shell.extensions } : {}),
    nodes: nodes.map((node) => ({
      ...node.data.model,
      id: node.id,
      position: node.position,
      width:
        node.measured?.width ??
        node.width ??
        numericStyleDimension(node.style?.width) ??
        node.data.model.width,
      height:
        node.measured?.height ??
        node.height ??
        numericStyleDimension(node.style?.height) ??
        node.data.model.height,
    })),
    connections: edges.map((edge) => {
      const connection = edge.data?.connection ?? {
        id: edge.id,
        kind: "basic" as const,
        source: edge.source,
        target: edge.target,
      };
      const {
        sourceHandle: _sourceHandle,
        targetHandle: _targetHandle,
        label: _label,
        color: _color,
        dashed: _dashed,
        arrow: _arrow,
        startArrow: _startArrow,
        ...persistentConnection
      } = connection;
      const label = typeof edge.label === "string" ? edge.label : undefined;
      const color =
        typeof edge.style?.stroke === "string" ? edge.style.stroke : undefined;
      return {
        ...persistentConnection,
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        ...(label !== undefined ? { label } : {}),
        dashed: Boolean(edge.style?.strokeDasharray),
        ...(color !== undefined ? { color } : {}),
        ...(connection.arrow !== undefined ||
        !unknownCanvasEnd(connection.extensions, "toEnd")
          ? { arrow: Boolean(edge.markerEnd) }
          : {}),
        ...(connection.startArrow !== undefined || edge.markerStart
          ? { startArrow: Boolean(edge.markerStart) }
          : {}),
      };
    }),
  });
}

export function updateFlowNodeModel(
  node: CanvasFlowNode,
  update: (model: CanvasNode) => CanvasNode,
): CanvasFlowNode {
  const model = update(node.data.model);
  return { ...node, type: model.kind, data: { ...node.data, model } };
}

export function applySourceResolutionResults(
  nodes: CanvasFlowNode[],
  generation: number,
  results: readonly SourceResolutionResult[],
): CanvasFlowNode[] {
  const resolved = new Map(
    results.flatMap((result) =>
      result.generation === generation && result.status === "resolved"
        ? [[result.nodeId, result.acquisition] as const]
        : [],
    ),
  );
  if (!resolved.size) return nodes;
  return nodes.map((node) => {
    const acquisition = resolved.get(node.id);
    return acquisition ? applyResolvedAcquisition(node, acquisition) : node;
  });
}

export function sourceOwnedResolutionResults(
  nodes: readonly CanvasFlowNode[],
  generation: number,
  results: readonly SourceResolutionResult[],
): SourceResolutionResult[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return results.filter((result) => {
    if (result.generation !== generation || result.status !== "resolved") {
      return false;
    }
    const node = nodesById.get(result.nodeId);
    return Boolean(
      node && applyResolvedAcquisition(node, result.acquisition) !== node,
    );
  });
}

export function applySourceOwnedResolutionResults(
  document: CanvasDocument,
  generation: number,
  results: readonly SourceResolutionResult[],
): CanvasDocument {
  const resolved = new Map(
    results.flatMap((result) =>
      result.generation === generation && result.status === "resolved"
        ? [[result.nodeId, result.acquisition] as const]
        : [],
    ),
  );
  if (!resolved.size) return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const acquisition = resolved.get(node.id);
    if (!acquisition) return node;
    const next = applyResolvedAcquisitionToCanvasNode(node, acquisition);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...document, nodes } : document;
}

export function beginNodeEditing(
  nodes: CanvasFlowNode[],
  nodeId: string,
): {
  nodes: CanvasFlowNode[];
  editing: { nodeId: string; value: string };
} | null {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  return {
    nodes: nodes.map((item) => ({
      ...item,
      className: item.id === nodeId ? "is-editing-label" : undefined,
    })),
    editing: { nodeId, value: flowNodeText(node) },
  };
}

export function flowNodeText(node: CanvasFlowNode): string {
  const model = node.data.model;
  if (model.kind === "note") {
    return model.content;
  }
  if (model.kind === "frame") return model.title;
  if (model.kind === "literature") return model.snapshot.title;
  if (model.kind === "quote") return model.snapshot.text;
  return model.data.title;
}

export function mergeEditingStyle(
  node: CanvasFlowNode,
  text: string,
  patch: Partial<CanvasNodeStyle>,
): CanvasFlowNode {
  return updateFlowNodeModel(node, (model) => ({
    ...updateCanvasNodeText(model, text),
    style: { ...(model.style ?? {}), ...patch },
  }));
}

export function toggleEditingBold(
  node: CanvasFlowNode,
  text: string,
): CanvasFlowNode {
  const effective = effectiveCanvasNodeTextStyle(
    node.data.model.kind,
    node.data.model.style,
  );
  return mergeEditingStyle(node, text, {
    fontWeight: effective.fontWeight === "bold" ? "normal" : "bold",
  });
}

type CanvasEdgeStylePatch = Partial<
  Pick<CanvasConnectionBase, "color" | "dashed" | "arrow" | "startArrow">
>;

function edgeMarker(
  existing: CanvasFlowEdge["markerEnd"] | CanvasFlowEdge["markerStart"],
  color: string,
) {
  const marker =
    existing && typeof existing === "object" ? existing : undefined;
  return marker
    ? {
        ...marker,
        width: marker.width ?? 16,
        height: marker.height ?? 16,
        color,
      }
    : { type: MarkerType.ArrowClosed, width: 16, height: 16, color };
}

export function withEdgeStyle(
  edge: CanvasFlowEdge,
  patch: CanvasEdgeStylePatch,
): CanvasFlowEdge {
  const current =
    edge.data?.connection ??
    ({
      id: edge.id,
      kind: "basic",
      source: edge.source,
      target: edge.target,
    } satisfies CanvasConnection);
  const connection: CanvasConnection = { ...current };
  if (current.extensions) {
    connection.extensions = { ...current.extensions };
  }
  for (const key of ["color", "dashed", "arrow", "startArrow"] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      const value = patch[key];
      if (value === undefined) delete connection[key];
      else Object.assign(connection, { [key]: value });
      if (key === "arrow" || key === "startArrow") {
        const endpoint = key === "arrow" ? "toEnd" : "fromEnd";
        const extensions = connection.extensions;
        if (
          extensions &&
          Object.prototype.hasOwnProperty.call(extensions, endpoint)
        ) {
          delete extensions[endpoint];
          if (!Object.keys(extensions).length) delete connection.extensions;
        }
      }
    }
  }
  const color =
    typeof patch.color === "string"
      ? patch.color
      : typeof edge.style?.stroke === "string"
        ? edge.style.stroke
        : (connection.color ?? "#9ca3af");
  const style = { ...(edge.style ?? {}) };
  if (Object.prototype.hasOwnProperty.call(patch, "color")) {
    style.stroke = patch.color;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "dashed")) {
    style.strokeDasharray = patch.dashed ? "6 4" : undefined;
  }
  return {
    ...edge,
    data: { ...(edge.data ?? {}), connection },
    style,
    ...(Object.prototype.hasOwnProperty.call(patch, "arrow")
      ? {
          markerEnd:
            patch.arrow === false
              ? undefined
              : edgeMarker(edge.markerEnd, color),
        }
      : Object.prototype.hasOwnProperty.call(patch, "color") && edge.markerEnd
        ? { markerEnd: edgeMarker(edge.markerEnd, color) }
        : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "startArrow")
      ? {
          markerStart:
            patch.startArrow === true
              ? edgeMarker(edge.markerStart, color)
              : undefined,
        }
      : Object.prototype.hasOwnProperty.call(patch, "color") && edge.markerStart
        ? { markerStart: edgeMarker(edge.markerStart, color) }
        : {}),
  };
}

export function withEdgeColor(
  edge: CanvasFlowEdge,
  color: string,
): CanvasFlowEdge {
  return withEdgeStyle(edge, { color });
}

export class CanvasDocumentHistory {
  revision = 0;
  private history: CanvasDocument[] = [];
  private future: CanvasDocument[] = [];

  constructor(private readonly onChange: (revision: number) => void) {}

  changed() {
    this.revision += 1;
    this.onChange(this.revision);
  }

  push(document: CanvasDocument) {
    this.history.push(document);
    if (this.history.length > 80) this.history.shift();
    this.future = [];
  }

  commit(document: CanvasDocument) {
    this.push(document);
    this.changed();
  }

  replace() {
    this.history = [];
    this.future = [];
  }

  rebase(update: (document: CanvasDocument) => CanvasDocument) {
    this.history = this.history.map(update);
    this.future = this.future.map(update);
  }

  undo(current: CanvasDocument): CanvasDocument | undefined {
    const previous = this.history.pop();
    if (!previous) return undefined;
    this.future.push(current);
    this.changed();
    return previous;
  }

  redo(current: CanvasDocument): CanvasDocument | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.history.push(current);
    this.changed();
    return next;
  }
}

function numericStyleDimension(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function unknownCanvasEnd(
  extensions: CanvasConnection["extensions"],
  key: "fromEnd" | "toEnd",
): boolean {
  const value = extensions?.[key];
  return value !== undefined && value !== "none" && value !== "arrow";
}

function omitUndefinedRecordFields<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return value;
  }
  const clone = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype);
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      if (!Array.isArray(value) && descriptor.value === undefined) continue;
      descriptor.value = omitUndefinedRecordFields(descriptor.value, seen);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone as T;
}

export function updateCanvasNodeText(
  model: CanvasNode,
  text: string,
): CanvasNode {
  switch (model.kind) {
    case "note":
      return { ...model, content: text };
    case "frame":
      return { ...model, title: text };
    case "literature":
      return { ...model, snapshot: { ...model.snapshot, title: text } };
    case "quote":
      return { ...model, snapshot: { ...model.snapshot, text } };
    default:
      return { ...model, data: { ...model.data, title: text } };
  }
}

/** Keep the explicit CSS size in step with React Flow's resize measurements. */
export function applyCanvasNodeChanges(
  changes: NodeChange<CanvasFlowNode>[],
  nodes: CanvasFlowNode[],
): CanvasFlowNode[] {
  const resized = new Set(
    changes.flatMap((change) =>
      change.type === "dimensions" && change.setAttributes && change.dimensions
        ? [change.id]
        : [],
    ),
  );
  return applyNodeChanges(changes, nodes).map((node) =>
    resized.has(node.id)
      ? {
          ...node,
          style: { ...node.style, width: node.width, height: node.height },
        }
      : node,
  );
}
