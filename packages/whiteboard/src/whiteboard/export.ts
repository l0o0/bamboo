import { noteReferenceHref } from "../model/academic";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteTypeIcon } from "./icons";
import { noteTypeLabel, noteTypePrompt } from "../chrome/labels";
import { connectionDisplayLabel } from "../chrome/ConnectionEditor";
import type { WhiteboardLabels, WhiteboardTheme } from "../model/protocol";
import { getBezierPath, Position } from "@xyflow/react";
import {
  canvasNodeUiSurfaceDefaults,
  canvasThemePalette,
  getNoteType,
  getNoteTitle,
  effectiveCanvasNodeTextStyle,
  type NoteAttachment,
  type CanvasNode,
} from "../model/academic";
import type { CanvasNodeStyle } from "../model/core";
import type { CanvasDocument } from "../model/document";
import { isConnectionSide } from "../model/connection";
import { isSafeAttachmentDataUrl } from "../model/file-attachment";
import { originalImagePreview } from "./file-import";

export function connectionEndpoint(
  node: Pick<CanvasNode, "position" | "width" | "height">,
  handle: string | null | undefined,
  fallback: Position,
) {
  const position = isConnectionSide(handle) ? (handle as Position) : fallback;
  return {
    x:
      node.position.x +
      (position === Position.Left
        ? 0
        : position === Position.Right
          ? node.width
          : node.width / 2),
    y:
      node.position.y +
      (position === Position.Top
        ? 0
        : position === Position.Bottom
          ? node.height
          : node.height / 2),
    position,
  };
}

function strokeLabelBounds(
  node: Extract<CanvasNode, { kind: "line" | "arrow" }>,
) {
  const style = node.style;
  const from = node.data.from ?? { x: 0, y: node.height / 2 };
  const to = node.data.to ?? { x: node.width, y: node.height / 2 };
  const { x, y } = node.position;
  const fontSize = effectiveCanvasNodeTextStyle(node.kind, style).fontSize;
  const labelWidth = Math.min(
    280,
    Math.max(
      72,
      26 +
        Math.max(
          ...node.data.title
            .split("\n")
            .map((line) =>
              [...line].reduce(
                (sum, char) => sum + glyphWidth(char, fontSize),
                0,
              ),
            ),
        ),
    ),
  );
  const labelHeight =
    wrappedTextLines(node.data.title, labelWidth - 24, fontSize).length *
      fontSize *
      1.25 +
    16;
  const labelX = x + (from.x + to.x) / 2 - labelWidth / 2;
  const labelY = y + (from.y + to.y) / 2 - labelHeight / 2;
  return { x: labelX, y: labelY, width: labelWidth, height: labelHeight };
}

export function boundsOf(nodes: CanvasNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 600 };
  const boxes = nodes.flatMap((node) => [
    { ...node.position, width: node.width, height: node.height },
    ...((node.kind === "line" || node.kind === "arrow") && node.data.title
      ? [strokeLabelBounds(node)]
      : []),
  ]);
  const left = Math.min(...boxes.map((n) => n.x));
  const top = Math.min(...boxes.map((n) => n.y));
  const right = Math.max(...boxes.map((n) => n.x + n.width));
  const bottom = Math.max(...boxes.map((n) => n.y + n.height));
  return {
    x: left - 40,
    y: top - 40,
    width: right - left + 80,
    height: bottom - top + 80,
  };
}

function escapeXml(value: string): string {
  let xmlSafe = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    xmlSafe +=
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
        ? character
        : "\ufffd";
  }
  return xmlSafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function strokeDash(
  style: CanvasNodeStyle,
  defaultDashed = false,
): string | undefined {
  if (style.strokeStyle === "dotted") return "2 6";
  if (style.strokeStyle === "dashed") return "12 9";
  if (style.strokeStyle === "solid") return undefined;
  return (style.dashed ?? defaultDashed) ? "12 9" : undefined;
}

function attribute(name: string, value: string | number | undefined): string {
  return value === undefined ? "" : ` ${name}="${escapeXml(String(value))}"`;
}

function glyphWidth(character: string, fontSize: number): number {
  if (/\s/u.test(character)) return fontSize * 0.33;
  if (/[ilI1.,'`:;!|]/u.test(character)) return fontSize * 0.3;
  if (/[MW@%&#]/u.test(character)) return fontSize * 0.9;
  const codePoint = character.codePointAt(0) ?? 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return fontSize;
  }
  return fontSize * 0.6;
}

function wrapVisualLine(
  value: string,
  availableWidth: number,
  fontSize: number,
): string[] {
  const characters = Array.from(value);
  if (!characters.length) return [""];
  const lines: string[] = [];
  let start = 0;
  while (start < characters.length) {
    while (start < characters.length && /\s/u.test(characters[start]!)) {
      start += 1;
    }
    if (start >= characters.length) break;
    let end = start;
    let width = 0;
    let lastBreak = -1;
    while (end < characters.length) {
      const nextWidth = width + glyphWidth(characters[end]!, fontSize);
      if (nextWidth > availableWidth && end > start) break;
      width = nextWidth;
      if (/\s/u.test(characters[end]!)) lastBreak = end;
      end += 1;
      if (width > availableWidth) break;
    }
    if (end >= characters.length) {
      lines.push(characters.slice(start).join("").trimEnd());
      break;
    }
    if (lastBreak >= start) {
      lines.push(characters.slice(start, lastBreak).join("").trimEnd());
      start = lastBreak + 1;
      continue;
    }
    lines.push(characters.slice(start, end).join(""));
    start = end;
  }
  return lines.length ? lines : [""];
}

function wrappedTextLines(
  value: string,
  availableWidth: number,
  fontSize: number,
): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => wrapVisualLine(line, availableWidth, fontSize));
}

function textPadding(
  node: CanvasNode,
  width: number,
  height: number,
): {
  horizontal: number;
  vertical: number;
} {
  if (node.style?.shape === "diamond") {
    return {
      horizontal: Math.max(12, width * 0.24),
      vertical: Math.max(8, height * 0.21),
    };
  }
  return {
    horizontal: 12,
    vertical: node.kind === "line" || node.kind === "arrow" ? 0 : 12,
  };
}

function textElement(
  node: CanvasNode,
  width: number,
  height: number,
  clipId: string,
  lineHeightRatio = 1.25,
  paddingOverride?: { horizontal: number; vertical: number },
): string {
  const title = canvasNodeText(node);
  if (!title) return "";
  const style = effectiveCanvasNodeTextStyle(node.kind, node.style);
  const padding = paddingOverride ?? textPadding(node, width, height);
  const fontSize = style.fontSize;
  const lineHeight = fontSize * lineHeightRatio;
  const availableWidth = Math.max(1, width - padding.horizontal * 2);
  const availableHeight = Math.max(0, height - padding.vertical * 2);
  const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
  const lines = wrappedTextLines(title, availableWidth, fontSize).slice(
    0,
    maxLines,
  );
  const align = style.textAlign;
  const vertical = style.verticalAlign;
  const x =
    node.position.x +
    (align === "left"
      ? padding.horizontal
      : align === "right"
        ? width - padding.horizontal
        : width / 2);
  const blockHeight = fontSize + (lines.length - 1) * lineHeight;
  const firstBaseline =
    node.position.y +
    (vertical === "top"
      ? padding.vertical + fontSize * 0.8
      : vertical === "bottom"
        ? height -
          padding.vertical -
          fontSize * 0.2 -
          (lines.length - 1) * lineHeight
        : height / 2 - blockHeight / 2 + fontSize * 0.8);
  const anchor =
    align === "left" ? "start" : align === "right" ? "end" : "middle";
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan${attribute("x", x)}${attribute("y", firstBaseline + index * lineHeight)}>${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text${attribute("x", x)}${attribute("y", firstBaseline)}${attribute("font-family", style.fontFamily)}${attribute("font-size", fontSize)}${attribute("font-weight", style.fontWeight)}${attribute("font-style", style.fontStyle)}${attribute("text-decoration", style.textDecoration)}${attribute("text-anchor", anchor)}${attribute("fill", style.textColor)}${attribute("opacity", style.textOpacity)}${attribute("clip-path", `url(#${clipId})`)}>${tspans}</text>`;
}

export function canvasNodeText(node: CanvasNode): string {
  switch (node.kind) {
    case "literature":
      return node.snapshot.title;
    case "quote":
      return node.snapshot.text;
    case "note":
      return node.content;
    case "frame":
      return node.title;
    case "item":
    case "pdf":
    case "attachment":
    case "text":
    case "rect":
    case "ellipse":
    case "line":
    case "arrow":
      return node.data.title;
  }
  node satisfies never;
  throw new Error("Unsupported canvas node kind.");
}

export function containGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

export function buildCanvasSvg(
  doc: CanvasDocument,
  labels?: WhiteboardLabels,
  appearance?: {
    fontFamily: string;
    backgroundColor: string;
    theme?: WhiteboardTheme;
  },
): string {
  const theme = appearance?.theme ?? "light";
  const palette = canvasThemePalette(theme);
  if (appearance) {
    doc = {
      ...doc,
      nodes: doc.nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          textColor: node.style?.textColor ?? palette.text,
          fontFamily: node.style?.fontFamily || appearance.fontFamily,
        },
      })),
      connections: doc.connections.map((edge) => ({
        ...edge,
        textStyle: {
          ...edge.textStyle,
          textColor: edge.textStyle?.textColor ?? palette.text,
          fontFamily: edge.textStyle?.fontFamily || appearance.fontFamily,
        },
      })),
    };
  }
  const backgroundColor =
    appearance && /^#[\da-f]{6}$/i.test(appearance.backgroundColor)
      ? appearance.backgroundColor
      : "#fbfbfc";
  const bounds = boundsOf(doc.nodes);
  const definitions = new Map<string, string>();
  const paintIds = new Map<string, string>();
  let nextPaintId = 0;
  const paintId = (prefix: "arrow" | "hatch", color: string) => {
    const key = `${prefix}\u0000${color}`;
    const existing = paintIds.get(key);
    if (existing) return existing;
    const id = `canvas-${prefix}-${nextPaintId}`;
    nextPaintId += 1;
    paintIds.set(key, id);
    return id;
  };
  const arrowMarker = (color: string) => {
    const id = paintId("arrow", color);
    definitions.set(
      id,
      `<marker id="${escapeXml(id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXml(color)}"/></marker>`,
    );
    return id;
  };
  const fillValue = (fill: string, fillStyle: CanvasNodeStyle["fillStyle"]) => {
    if (fillStyle === "none" || fill === "transparent") return "none";
    if (fillStyle !== "hatch") return fill;
    const id = paintId("hatch", fill);
    definitions.set(
      id,
      `<pattern id="${escapeXml(id)}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${escapeXml(fill)}"/><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="currentColor" stroke-width="1" opacity="0.25"/></pattern>`,
    );
    return `url(#${id})`;
  };
  const orderedNodes = [
    ...doc.nodes.filter((node) => node.kind === "frame"),
    ...doc.nodes.filter((node) => node.kind !== "frame"),
  ];
  const frameCount = orderedNodes.findIndex((node) => node.kind !== "frame");
  const renderedNodes = orderedNodes.map((node, index) => {
    const x = node.position.x;
    const y = node.position.y;
    const width = node.width;
    const height = node.height;
    const style = node.style ?? {};
    const defaults = canvasNodeUiSurfaceDefaults(
      node.kind,
      theme,
      node.kind === "note" ? getNoteType(node) : undefined,
    );
    const stroke = style.stroke || defaults.stroke;
    const fill = fillValue(style.fill || defaults.fill, style.fillStyle);
    const strokeWidth = style.strokeWidth ?? defaults.strokeWidth;
    const borderStyle =
      style.strokeStyle ??
      (style.dashed === undefined
        ? defaults.strokeStyle
        : style.dashed
          ? "dashed"
          : "solid");
    const dash =
      node.kind === "line" || node.kind === "arrow"
        ? strokeDash(style, defaults.strokeStyle !== "solid")
        : borderStyle === "dotted"
          ? `${strokeWidth} ${strokeWidth}`
          : borderStyle === "dashed"
            ? `${strokeWidth * 3} ${strokeWidth * 3}`
            : undefined;
    const common = `${attribute("fill", fill)}${attribute("stroke", stroke)}${attribute("stroke-width", strokeWidth)}${attribute("stroke-opacity", style.strokeOpacity)}${attribute("stroke-dasharray", dash)}`;
    const clipId = `canvas-node-clip-${index}`;
    let text = textElement(node, width, height, clipId);
    if (text) {
      const padding = textPadding(node, width, height);
      const clip =
        node.style?.shape === "diamond"
          ? `<polygon${attribute("points", `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`)}/>`
          : `<rect${attribute("x", x + padding.horizontal)}${attribute("y", y + padding.vertical)}${attribute("width", Math.max(0, width - padding.horizontal * 2))}${attribute("height", Math.max(0, height - padding.vertical * 2))}/>`;
      definitions.set(clipId, `<clipPath id="${clipId}">${clip}</clipPath>`);
    }
    if (node.kind === "note") {
      const type = getNoteType(node);
      const heading = labels ? noteTypeLabel(labels, type) : type;
      const title = getNoteTitle(node);
      const prompt = labels
        ? noteTypePrompt(labels, type)
        : "Write your thoughts or reading notes.";
      const body = node.content === "" ? prompt : node.content;
      const headerColor = style.textColor ?? "#816b4e";
      const icon = renderToStaticMarkup(createElement(NoteTypeIcon, { type }));
      definitions.set(
        clipId,
        `<clipPath id="${clipId}"><rect x="${x + 14}" y="${y + 12}" width="${Math.max(0, width - 28)}" height="${Math.max(0, height - 24)}"/></clipPath>`,
      );
      const bodyNode = {
        ...node,
        content: body,
        position: { x: x + 2, y: y + 22 },
        style: {
          ...style,
          textOpacity:
            (style.textOpacity ?? 1) * (node.content === "" ? 0.65 : 1),
        },
      };
      text =
        `<g clip-path="url(#${clipId})"><svg x="${x + 14}" y="${y + 12}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" color="${escapeXml(headerColor)}">${icon.replace(/<svg[^>]*>|<\/svg>/g, "")}</svg><text x="${x + 34}" y="${y + 23}" font-family="${escapeXml(appearance?.fontFamily || "system-ui, sans-serif")}" font-size="11" font-weight="500" fill="${escapeXml(headerColor)}">${escapeXml(heading.toUpperCase() + (title ? ` · ${title}` : ""))}</text></g>` +
        textElement(
          bodyNode,
          width - 4,
          Math.max(0, height - 22),
          clipId,
          1.45,
        );
    }
    if (node.kind === "line" || node.kind === "arrow") {
      const from = node.data.from ?? { x: 0, y: height / 2 };
      const to = node.data.to ?? { x: width, y: height / 2 };
      let label = "";
      if (node.data.title) {
        const {
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight,
        } = strokeLabelBounds(node);
        const box = `${attribute("x", labelX)}${attribute("y", labelY)}${attribute("width", labelWidth)}${attribute("height", labelHeight)}${attribute("rx", 8)}`;
        definitions.set(
          clipId,
          `<clipPath id="${clipId}"><rect${box}/></clipPath>`,
        );
        label =
          `<rect${box} fill="${palette.surface}" stroke="${palette.border}"/>` +
          textElement(
            {
              ...node,
              position: { x: labelX, y: labelY },
              style: { ...style, verticalAlign: "middle" },
            },
            labelWidth,
            labelHeight,
            clipId,
          );
      }
      const marker =
        node.kind === "arrow"
          ? attribute("marker-end", `url(#${arrowMarker(stroke)})`)
          : "";
      return `<g><line${attribute("x1", x + from.x)}${attribute("y1", y + from.y)}${attribute("x2", x + to.x)}${attribute("y2", y + to.y)}${attribute("stroke", stroke)}${attribute("stroke-width", strokeWidth)}${attribute("stroke-opacity", style.strokeOpacity)}${attribute("stroke-dasharray", dash)}${marker}/>${label}</g>`;
    }
    if (node.kind === "pdf" || node.kind === "attachment") {
      const preview = originalImagePreview(
        node.data.image,
        node.data.fileData,
        node.data.contentType,
      );
      if (preview) {
        const previewWidth = Math.max(1, width - 24);
        const previewHeight = Math.max(
          1,
          Math.min(height * 0.56, Math.max(1, height - 42)),
        );
        const sourceWidth = node.data.imageWidth ?? 16;
        const sourceHeight = node.data.imageHeight ?? 9;
        const geometry = containGeometry(
          sourceWidth,
          sourceHeight,
          previewWidth,
          previewHeight,
        );
        const textHeight = Math.max(1, height - previewHeight - 8);
        const textNode = {
          ...node,
          position: { x, y: y + previewHeight + 8 },
          height: textHeight,
        };
        definitions.set(
          clipId,
          `<clipPath id="${clipId}"><rect x="${x}" y="${y + previewHeight + 8}" width="${width}" height="${textHeight}"/></clipPath>`,
        );
        const fileHref = attachmentExportHref(node);
        const opening = fileHref
          ? `<a href="${escapeXml(fileHref)}" download="${escapeXml(node.data.title)}">`
          : "";
        const closing = fileHref ? "</a>" : "";
        const rx = style.radius ?? defaults.radius;
        const surface = `<rect${attribute("x", x)}${attribute("y", y)}${attribute("width", width)}${attribute("height", height)}${attribute("rx", rx)}${common}/>`;
        return `<g>${opening}${surface}<image${attribute("x", x + 12 + geometry.x)}${attribute("y", y + 12 + geometry.y)}${attribute("width", geometry.width)}${attribute("height", geometry.height)} preserveAspectRatio="none" href="${escapeXml(preview)}"/>${textElement(textNode, width, textHeight, clipId)}${closing}</g>`;
      }
    }
    if (node.style?.shape === "diamond") {
      const points = `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`;
      return `<g><polygon${attribute("points", points)}${common}/>${text}</g>`;
    }
    if (node.kind === "ellipse") {
      return `<g><ellipse${attribute("cx", x + width / 2)}${attribute("cy", y + height / 2)}${attribute("rx", width / 2)}${attribute("ry", height / 2)}${common}/>${text}</g>`;
    }
    const rx = style.radius ?? defaults.radius;
    return `<g><rect${attribute("x", x)}${attribute("y", y)}${attribute("width", width)}${attribute("height", height)}${attribute("rx", rx)}${common}/>${text}</g>`;
  });
  const splitIndex = frameCount < 0 ? renderedNodes.length : frameCount;
  const frames = renderedNodes.slice(0, splitIndex).join("\n");
  const shapes = renderedNodes.slice(splitIndex).join("\n");
  const edges = doc.connections
    .map((edge) => {
      const source = doc.nodes.find((n) => n.id === edge.source);
      const target = doc.nodes.find((n) => n.id === edge.target);
      if (!source || !target) return "";
      const from = connectionEndpoint(
        source,
        edge.sourceHandle,
        Position.Right,
      );
      const to = connectionEndpoint(target, edge.targetHandle, Position.Left);
      const [path, labelX, labelY] = getBezierPath({
        sourceX: from.x,
        sourceY: from.y,
        sourcePosition: from.position,
        targetX: to.x,
        targetY: to.y,
        targetPosition: to.position,
      });
      const color = edge.color || (appearance ? palette.edge : "#94a3b8");
      const marker =
        edge.arrow === false
          ? ""
          : attribute("marker-end", `url(#${arrowMarker(color)})`);
      const startMarker =
        edge.startArrow === true
          ? attribute("marker-start", `url(#${arrowMarker(color)})`)
          : "";
      const relation =
        edge.kind === "academic"
          ? attribute("data-relation", edge.relation)
          : "";
      const label = labels
        ? connectionDisplayLabel(edge, labels)
        : (edge.label ??
          (edge.kind === "academic" ? edge.relation : undefined));
      let labelSvg = "";
      if (label) {
        const style = { fontSize: 12, ...edge.textStyle };
        const lines = label.split("\n");
        const fontSize = style.fontSize;
        const width =
          Math.max(
            ...lines.map((line) =>
              [...line].reduce(
                (sum, char) => sum + glyphWidth(char, fontSize),
                0,
              ),
            ),
          ) + 24;
        const height = lines.length * fontSize * 1.25 + 14;
        const clipId = `canvas-edge-label-${definitions.size}`;
        const x = labelX - width / 2;
        const y = labelY - height / 2;
        definitions.set(
          clipId,
          `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>`,
        );
        labelSvg =
          `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${palette.surface}"/>` +
          textElement(
            {
              id: edge.id,
              kind: "text",
              position: { x, y },
              width,
              height,
              data: { title: label },
              style: { ...style, textAlign: "center", verticalAlign: "middle" },
            },
            width,
            height,
            clipId,
            1.25,
            { horizontal: 12, vertical: 7 },
          );
      }
      return `<path${relation}${attribute("d", path)} fill="none"${attribute("stroke", color)} stroke-width="1.5"${attribute("stroke-dasharray", edge.dashed ? "6 4" : undefined)}${startMarker}${marker}/>${labelSvg}`;
    })
    .filter(Boolean)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">
<defs>${[...definitions.values()].join("")}</defs>
<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${backgroundColor}"/>
${frames}
${edges}
${shapes}
</svg>`;
}

const ACADEMIC_KIND_ORDER = ["literature", "quote", "note", "frame"] as const;

const ACADEMIC_KIND_LABELS = {
  literature: "Literature",
  quote: "Quote",
  note: "Note",
  frame: "Frame",
} as const;

const ACADEMIC_KINDS = new Set<CanvasNode["kind"]>(ACADEMIC_KIND_ORDER);

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function inlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareNodes(a: CanvasNode, b: CanvasNode): number {
  return (
    compareStrings(
      inlineText(canvasNodeText(a)),
      inlineText(canvasNodeText(b)),
    ) || compareStrings(a.id, b.id)
  );
}

function basicKindLabel(kind: CanvasNode["kind"]): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

export function buildCanvasMarkdown(doc: CanvasDocument): string {
  const lines = ["# Academic Canvas", ""];
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const textCounts = new Map<string, number>();
  for (const node of doc.nodes) {
    const text = inlineText(canvasNodeText(node)) || node.kind;
    textCounts.set(text, (textCounts.get(text) ?? 0) + 1);
  }

  const endpointText = (id: string): string => {
    const node = byId.get(id);
    if (!node) return `[missing: ${id}]`;
    const text = inlineText(canvasNodeText(node)) || node.kind;
    return (textCounts.get(text) ?? 0) > 1 ? `${text} [${node.id}]` : text;
  };

  for (const kind of ACADEMIC_KIND_ORDER) {
    const nodes = doc.nodes
      .filter((node) => node.kind === kind)
      .sort(compareNodes);
    for (const node of nodes) {
      const text = inlineText(canvasNodeText(node)) || node.kind;
      lines.push(`## ${ACADEMIC_KIND_LABELS[kind]}: ${text}`, "");
      if (node.kind === "literature") {
        const citation = [node.snapshot.creators, node.snapshot.year]
          .filter(Boolean)
          .join(" · ");
        if (citation) lines.push(citation, "");
      } else if (node.kind === "quote") {
        lines.push(
          ...node.snapshot.text.split(/\r?\n/).map((line) => `> ${line}`),
          "",
        );
      } else if (node.kind === "note" && /\r?\n/.test(node.content)) {
        lines.push(node.content, "");
      }
      if (node.kind === "note" && node.references?.length) {
        lines.push(
          ...node.references.map(
            (reference) =>
              `- [${escapeMarkdownImageAlt(reference.title)}](${noteReferenceHref(reference)})`,
          ),
          "",
        );
      }
      if (node.kind === "note" && node.attachments?.length) {
        lines.push(
          ...node.attachments.map((attachment) => {
            const href = noteAttachmentExportHref(attachment);
            return href
              ? `- [${escapeMarkdownImageAlt(attachment.title)}](${href})`
              : `- ${escapeMarkdownImageAlt(attachment.title)} (${attachment.contentType})`;
          }),
          "",
        );
      }
    }
  }

  const basicNodes = doc.nodes
    .filter((node) => !ACADEMIC_KINDS.has(node.kind))
    .sort((a, b) => compareStrings(a.kind, b.kind) || compareNodes(a, b));
  if (basicNodes.length) {
    lines.push("## Other objects", "");
    for (const node of basicNodes) {
      const text = inlineText(canvasNodeText(node)) || node.kind;
      lines.push(`- ${basicKindLabel(node.kind)}: ${text} [${node.id}]`);
      if (node.kind === "attachment" || node.kind === "pdf") {
        const preview = originalImagePreview(
          node.data.image,
          node.data.fileData,
          node.data.contentType,
        );
        if (preview) {
          lines.push(
            `  ![${escapeMarkdownImageAlt(node.data.title)}](${preview})`,
          );
        } else {
          const fileHref = attachmentExportHref(node);
          if (fileHref) {
            lines.push(
              `  [${escapeMarkdownImageAlt(node.data.title)}](${fileHref})`,
            );
          }
        }
      }
    }
    lines.push("");
  }

  if (doc.connections.length) {
    const relationships = doc.connections
      .map((connection) => ({
        id: connection.id,
        relation:
          connection.kind === "academic"
            ? connection.relation
            : inlineText(connection.label ?? "") || "connects",
        source: endpointText(connection.source),
        target: endpointText(connection.target),
      }))
      .sort(
        (a, b) =>
          compareStrings(a.relation, b.relation) ||
          compareStrings(a.source, b.source) ||
          compareStrings(a.target, b.target) ||
          compareStrings(a.id, b.id),
      );
    lines.push("## Relationships", "");
    for (const relationship of relationships) {
      lines.push(
        `- ${relationship.relation}: ${relationship.source} → ${relationship.target}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function attachmentExportHref(
  node: Extract<CanvasNode, { kind: "attachment" | "pdf" }>,
): string | undefined {
  const fileData = node.data.fileData;
  if (!fileData || !isSafeAttachmentDataUrl(fileData)) return undefined;
  const mimeType = fileData.slice(5, fileData.indexOf(",")).split(";", 1)[0];
  if (
    /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)$/iu.test(mimeType)
  ) {
    return undefined;
  }
  return fileData;
}

function noteAttachmentExportHref(
  attachment: NoteAttachment,
): string | undefined {
  if (!isSafeAttachmentDataUrl(attachment.fileData)) return undefined;
  const mimeType = attachment.fileData
    .slice(5, attachment.fileData.indexOf(","))
    .split(";", 1)[0];
  return /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)$/iu.test(
    mimeType,
  )
    ? undefined
    : attachment.fileData;
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&").replace(/[\r\n]/g, " ");
}

export function svgToPngDataUrl(
  svg: string,
  width = 1600,
  height = 1200,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(svg);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.fillStyle = "#fbfbfc";
      ctx.fillRect(0, 0, width, height);
      const target = containGeometry(
        image.naturalWidth,
        image.naturalHeight,
        width,
        height,
      );
      ctx.drawImage(image, target.x, target.y, target.width, target.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.onerror = () => reject(new Error("SVG render failed"));
    image.src = `data:image/svg+xml;charset=utf-8,${encoded}`;
  });
}
