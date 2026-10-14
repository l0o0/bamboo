import { createElement, Fragment, memo, type ComponentType } from "react";
import { NodeResizer, useStore, type NodeProps } from "@xyflow/react";
import { CardShell } from "./CardShell";
import { useWhiteboardLabels, noteTypeLabel } from "../chrome/labels";
import { getNoteType } from "../model/academic";
import {
  COMPACT_CARD_ZOOM,
  compactCardTitle,
  useFullCanvasRender,
} from "../whiteboard/rendering";
import {
  ACADEMIC_SOURCE_CARD_SIZE,
  type CanvasNodeKind,
} from "../model/academic";
import { FrameNode, LiteratureNode, NoteNode, QuoteNode } from "./academic";
import { AttachmentNode, ItemNode, PdfNode } from "./library";
import { ArrowNode, EllipseNode, LineNode, RectNode, TextNode } from "./shapes";
import type { CanvasFlowNode, NodeGroup } from "./types";

export interface WhiteboardNodeSpec {
  kind: CanvasNodeKind;
  group: NodeGroup;
  defaultWidth: number;
  defaultHeight: number;
  Component: ComponentType<NodeProps<CanvasFlowNode>>;
}

/**
 * Registry of custom React nodes. Add a spec here to expose a new
 * canvas type without touching React Flow wiring.
 */
const NODE_SPECS: WhiteboardNodeSpec[] = [
  {
    kind: "item",
    group: "library",
    defaultWidth: 240,
    defaultHeight: 96,
    Component: ItemNode,
  },
  {
    kind: "pdf",
    group: "library",
    defaultWidth: 240,
    defaultHeight: 220,
    Component: PdfNode,
  },
  {
    kind: "attachment",
    group: "library",
    defaultWidth: 240,
    defaultHeight: 96,
    Component: AttachmentNode,
  },
  {
    kind: "literature",
    group: "academic",
    defaultWidth: ACADEMIC_SOURCE_CARD_SIZE.literature.width,
    defaultHeight: ACADEMIC_SOURCE_CARD_SIZE.literature.height,
    Component: LiteratureNode,
  },
  {
    kind: "quote",
    group: "academic",
    defaultWidth: ACADEMIC_SOURCE_CARD_SIZE.quote.width,
    defaultHeight: ACADEMIC_SOURCE_CARD_SIZE.quote.height,
    Component: QuoteNode,
  },
  {
    kind: "note",
    group: "academic",
    defaultWidth: 260,
    defaultHeight: 152,
    Component: NoteNode,
  },
  {
    kind: "frame",
    group: "academic",
    defaultWidth: 480,
    defaultHeight: 320,
    Component: FrameNode,
  },
  {
    kind: "text",
    group: "draw",
    defaultWidth: 240,
    defaultHeight: 72,
    Component: TextNode,
  },
  {
    kind: "rect",
    group: "draw",
    defaultWidth: 140,
    defaultHeight: 88,
    Component: RectNode,
  },
  {
    kind: "ellipse",
    group: "draw",
    defaultWidth: 140,
    defaultHeight: 88,
    Component: EllipseNode,
  },
  {
    kind: "line",
    group: "draw",
    defaultWidth: 160,
    defaultHeight: 32,
    Component: LineNode,
  },
  {
    kind: "arrow",
    group: "draw",
    defaultWidth: 160,
    defaultHeight: 32,
    Component: ArrowNode,
  },
];

const byKind = new Map(NODE_SPECS.map((spec) => [spec.kind, spec]));

export function listNodeSpecs(group?: NodeGroup): WhiteboardNodeSpec[] {
  return group
    ? NODE_SPECS.filter((spec) => spec.group === group)
    : NODE_SPECS.slice();
}

export function getNodeSpec(kind: CanvasNodeKind): WhiteboardNodeSpec {
  const spec = byKind.get(kind);
  if (!spec) throw new Error(`Unknown whiteboard node kind: ${kind}`);
  return spec;
}

export const canvasNodeTypes = Object.fromEntries(
  NODE_SPECS.map((spec) => {
    const Component = memo(spec.Component);
    function RenderNode(props: NodeProps<CanvasFlowNode>) {
      // Subscribe to a boolean: panning and zooming within one detail level
      // do not rerender every card. Selected cards always remain interactive.
      const zoomedOut = useStore(
        (state) => state.transform[2] < COMPACT_CARD_ZOOM,
      );
      const fullRender = useFullCanvasRender();
      const labels = useWhiteboardLabels();
      const model = props.data.model;
      const supportsCompact = [
        "note",
        "literature",
        "quote",
        "item",
        "pdf",
        "attachment",
      ].includes(spec.kind);
      const compact =
        supportsCompact && zoomedOut && !props.selected && !fullRender;
      const kindLabel =
        model.kind === "note"
          ? noteTypeLabel(labels, getNoteType(model))
          : model.kind === "literature"
            ? labels.kindLiterature
            : model.kind === "quote"
              ? labels.kindQuote
              : model.kind === "item"
                ? labels.addItem
                : model.kind === "pdf"
                  ? labels.addPdf
                  : labels.fileGeneric;
      return createElement(
        Fragment,
        null,
        compact
          ? createElement(CardShell, {
              kind: model.kind,
              kindLabel,
              ...(model.kind === "note"
                ? { noteType: getNoteType(model) }
                : {}),
              nodeStyle: model.style,
              children: createElement(
                "p",
                { className: "zmd-board-card-title zmd-board-card-summary" },
                compactCardTitle(model) || kindLabel,
              ),
            })
          : createElement(Component, props),
        spec.kind !== "line" && spec.kind !== "arrow"
          ? createElement(NodeResizer, {
              isVisible: Boolean(props.selected && props.isConnectable),
              minWidth: spec.kind === "frame" ? 160 : 60,
              minHeight: spec.kind === "frame" ? 100 : 40,
              handleClassName: "zmd-board-resize-handle",
              lineClassName: "zmd-board-resize-line",
              color: "var(--zmd-board-accent, #2563eb)",
            })
          : null,
      );
    }
    return [spec.kind, RenderNode];
  }),
) as Record<CanvasNodeKind, WhiteboardNodeSpec["Component"]>;
