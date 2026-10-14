import type { CanvasDocument } from "../model/document";

/** Explicit assignment only; visual overlap never changes membership. */
export function joinFrame(
  document: CanvasDocument,
  nodeIds: readonly string[],
  frameId: string,
): CanvasDocument {
  const frame = document.nodes.find((node) => node.id === frameId);
  if (!frame || frame.kind !== "frame") return document;
  const ids = new Set(nodeIds);
  const members = document.nodes.filter(
    (node) => node.kind !== "frame" && ids.has(node.id),
  );
  if (
    !members.some((node) => node.kind !== "frame" && node.frameId !== frameId)
  )
    return document;
  // Keep the members in place, expanding the existing frame around them.
  const left = Math.min(
    frame.position.x,
    ...members.map((node) => node.position.x - 32),
  );
  const top = Math.min(
    frame.position.y,
    ...members.map((node) => node.position.y - 64),
  );
  const right = Math.max(
    frame.position.x + frame.width,
    ...members.map((node) => node.position.x + node.width + 32),
  );
  const bottom = Math.max(
    frame.position.y + frame.height,
    ...members.map((node) => node.position.y + node.height + 32),
  );
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === frameId
        ? {
            ...frame,
            position: { x: left, y: top },
            width: right - left,
            height: bottom - top,
          }
        : node.kind !== "frame" && ids.has(node.id) && node.frameId !== frameId
          ? { ...node, frameId }
          : node,
    ),
  };
}
