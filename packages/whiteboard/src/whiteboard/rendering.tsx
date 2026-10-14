import { createContext, useContext } from "react";
import type { CanvasNode } from "../model/academic";
import { getNoteTitle } from "../model/academic";
import { Position } from "@xyflow/react";
import type { CanvasFlowNode } from "../nodes/types";

/** Exports must include offscreen cards and their full content. */
export const FullCanvasRenderContext = createContext(false);
export const useFullCanvasRender = () => useContext(FullCanvasRenderContext);
export const COMPACT_CARD_ZOOM = 0.35;
export const CULLING_NODE_THRESHOLD = 80;

const displayNodes = new WeakMap<CanvasFlowNode, CanvasFlowNode>();

/** Fixed-size cards have known handle centers, even before entering the viewport.
 * React Flow otherwise mounts every node once to discover its handles. Keep
 * these display-only bounds out of the document and preserve unchanged nodes.
 */
export function attachCanvasHandles(nodes: CanvasFlowNode[]): CanvasFlowNode[] {
  return nodes.map((node) => {
    const cached = displayNodes.get(node);
    if (cached) return cached;
    const width = node.width ?? node.measured?.width ?? node.data.model.width;
    const height =
      node.height ?? node.measured?.height ?? node.data.model.height;
    const next: CanvasFlowNode = {
      ...node,
      measured: { width, height },
      handles:
        node.data.model.kind === "frame"
          ? []
          : [
              { position: Position.Right, x: width - 4, y: height / 2 - 4 },
              { position: Position.Left, x: -4, y: height / 2 - 4 },
              { position: Position.Top, x: width / 2 - 4, y: -4 },
              { position: Position.Bottom, x: width / 2 - 4, y: height - 4 },
            ].map((handle) => ({
              ...handle,
              id: handle.position,
              type: "source" as const,
              width: 8,
              height: 8,
            })),
    };
    displayNodes.set(node, next);
    return next;
  });
}

export function shouldCullCanvasNodes(
  nodeCount: number,
  fullRender: boolean,
  editing: boolean,
): boolean {
  return nodeCount >= CULLING_NODE_THRESHOLD && !fullRender && !editing;
}

export function compactCardTitle(node: CanvasNode): string {
  switch (node.kind) {
    case "note":
      return (getNoteTitle(node) || node.content.slice(0, 240).split("\n")[0])
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .slice(0, 160);
    case "literature":
      return node.snapshot.title.slice(0, 160);
    case "quote":
      return node.snapshot.text.slice(0, 160);
    case "item":
    case "pdf":
    case "attachment":
      return node.data.title.slice(0, 160);
    default:
      return "";
  }
}

/** Allow node mounts and React Flow measurements to finish before PNG capture. */
export async function waitForCanvasPaint(host: HTMLElement): Promise<void> {
  const win = host.ownerDocument.defaultView;
  if (!win || !host.isConnected) throw new Error("Canvas is closed");
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((resolve) => {
      let frame = 0;
      const done = () => {
        win.clearTimeout(timer);
        win.cancelAnimationFrame(frame);
        resolve();
      };
      const timer = win.setTimeout(done, 80);
      frame = win.requestAnimationFrame(done);
    });
    if (!host.isConnected) throw new Error("Canvas is closed");
  }
}
