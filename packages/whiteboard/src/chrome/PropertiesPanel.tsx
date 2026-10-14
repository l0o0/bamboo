import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import type { NoteType } from "../model/academic";
import type { NoteTemplate } from "../model/note-template";
import type { WhiteboardLabels } from "../model/protocol";
import type { CanvasFlowNode } from "../nodes";
import { IconCopy, IconOpen, IconTrash } from "../whiteboard/icons";
import { flowNodeText } from "../whiteboard/document";
import type { SourceResolutionState } from "../whiteboard/sourceState";
import { nodeKindLabel } from "./labels";
import { NoteTemplateControls } from "./NoteTemplateControls";

type PropertiesLabel = "selectionDetails" | "removeFromGroup";
type PanelRect = { x: number; y: number; width: number; height: number };
type PanelPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: "right" | "left" | "bottom" | "top";
};

export function placePropertiesPanel(
  anchor: PanelRect,
  panel: { width: number; height: number },
  viewport: PanelRect,
  expanded: boolean,
  toolbar?: PanelRect,
): PanelPlacement {
  const gap = 12;
  const left = viewport.x + 8;
  const top = viewport.y + 8;
  const right = viewport.x + viewport.width - 8;
  const bottom = viewport.y + viewport.height - 8;
  const width = Math.min(
    expanded ? 320 : panel.width,
    Math.max(1, right - left),
  );
  const maxHeight = Math.min(420, Math.max(1, bottom - top));
  const height = Math.min(panel.height, maxHeight);
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const centeredLeft = clamp(
    anchor.x + anchor.width / 2 - width / 2,
    left,
    right - width,
  );
  const alignedTop = clamp(anchor.y, top, bottom - height);
  const candidates: PanelPlacement[] = [
    {
      side: "right",
      left: anchor.x + anchor.width + gap,
      top: alignedTop,
      width,
      maxHeight,
    },
    {
      side: "left",
      left: anchor.x - gap - width,
      top: alignedTop,
      width,
      maxHeight,
    },
    {
      side: "bottom",
      left: centeredLeft,
      top: anchor.y + anchor.height + gap,
      width,
      maxHeight: Math.min(maxHeight, bottom - anchor.y - anchor.height - gap),
    },
    {
      side: "top",
      left: centeredLeft,
      top: anchor.y - gap - height,
      width,
      maxHeight: Math.min(maxHeight, anchor.y - gap - top),
    },
  ];
  const ordered = expanded
    ? candidates
    : [candidates[3], candidates[2], candidates[0], candidates[1]];
  const overlap = (candidate: PanelPlacement, rect: PanelRect) =>
    Math.max(
      0,
      Math.min(candidate.left + candidate.width, rect.x + rect.width) -
        Math.max(candidate.left, rect.x),
    ) *
    Math.max(
      0,
      Math.min(
        candidate.top + Math.min(height, candidate.maxHeight),
        rect.y + rect.height,
      ) - Math.max(candidate.top, rect.y),
    );
  const clearsToolbar = (candidate: PanelPlacement) =>
    !toolbar || overlap(candidate, toolbar) === 0;
  if (toolbar) {
    for (const candidate of ordered) {
      if (
        candidate.left >= toolbar.x + toolbar.width ||
        candidate.left + width <= toolbar.x
      )
        continue;
      if (candidate.side === "top") {
        const edge = Math.min(anchor.y, toolbar.y) - gap;
        candidate.top = edge - height;
        candidate.maxHeight = Math.min(maxHeight, edge - top);
      } else if (candidate.side === "bottom") {
        candidate.top =
          Math.max(anchor.y + anchor.height, toolbar.y + toolbar.height) + gap;
        candidate.maxHeight = Math.min(maxHeight, bottom - candidate.top);
      } else if (!clearsToolbar(candidate)) {
        const below = toolbar.y + toolbar.height + gap;
        const above = toolbar.y - gap - height;
        if (below + height <= bottom) candidate.top = below;
        else if (above >= top) candidate.top = above;
        else if (bottom - below >= Math.min(height, 160)) {
          candidate.top = below;
          candidate.maxHeight = Math.min(maxHeight, bottom - below);
        } else if (toolbar.y - gap - top >= Math.min(height, 160)) {
          candidate.top = top;
          candidate.maxHeight = Math.min(maxHeight, toolbar.y - gap - top);
        }
      }
    }
  }
  const fits = ordered.find(
    (candidate) =>
      candidate.left >= left &&
      candidate.left + width <= right &&
      candidate.top >= top &&
      candidate.top + height <= bottom &&
      clearsToolbar(candidate),
  );
  if (fits) return fits;

  // Keep the card clear even when the details need a narrower or scrollable panel.
  for (const candidate of ordered) {
    if (candidate.side === "right" || candidate.side === "left") {
      const available =
        candidate.side === "right"
          ? right - anchor.x - anchor.width - gap
          : anchor.x - gap - left;
      if (available >= Math.min(width, 260)) {
        const sizedWidth = Math.min(width, available);
        const sized = {
          ...candidate,
          width: sizedWidth,
          left: clamp(
            candidate.side === "left"
              ? anchor.x - gap - sizedWidth
              : candidate.left,
            left,
            right - sizedWidth,
          ),
        };
        if (clearsToolbar(sized)) return sized;
      }
    } else if (candidate.maxHeight >= Math.min(height, 160)) {
      const sized = {
        ...candidate,
        top: clamp(
          candidate.side === "top" ? top : candidate.top,
          top,
          bottom - Math.min(height, candidate.maxHeight),
        ),
      };
      if (clearsToolbar(sized)) return sized;
    }
  }

  // An oversized card can occupy every side. Keep controls reachable and minimize overlap.
  const obscured = (candidate: PanelPlacement) =>
    overlap(candidate, anchor) + (toolbar ? overlap(candidate, toolbar) : 0);
  return ordered
    .map((candidate) => ({
      ...candidate,
      left: clamp(candidate.left, left, right - width),
      top: clamp(candidate.top, top, bottom - height),
      maxHeight,
    }))
    .reduce((best, candidate) =>
      obscured(candidate) < obscured(best) ? candidate : best,
    );
}

function propertiesLabel(
  labels: WhiteboardLabels,
  key: PropertiesLabel,
  fallback: string,
): string {
  return (
    (labels as WhiteboardLabels & Partial<Record<PropertiesLabel, string>>)[
      key
    ] ?? fallback
  );
}

type FileDetails = {
  title: string;
  contentType?: string;
  size?: number;
  fileData?: string;
  imageWidth?: number;
  imageHeight?: number;
  pageCount?: number;
};

function fileLabel(
  labels: WhiteboardLabels,
  key: keyof Pick<
    WhiteboardLabels,
    | "fileOpen"
    | "fileDetails"
    | "fileUnavailable"
    | "fileDimensions"
    | "filePages"
  >,
  fallback: string,
): string {
  return labels[key] || fallback;
}

function fileDetailsForNode(node: CanvasFlowNode): FileDetails | null {
  const model = node.data.model;
  if (model.kind !== "attachment" && model.kind !== "pdf") return null;
  const data = model.data as Record<string, unknown>;
  return {
    title: typeof data.title === "string" ? data.title : "File",
    ...(typeof data.contentType === "string"
      ? { contentType: data.contentType }
      : {}),
    ...(typeof data.size === "number" ? { size: data.size } : {}),
    ...(typeof data.fileData === "string" ? { fileData: data.fileData } : {}),
    ...(typeof data.imageWidth === "number"
      ? { imageWidth: data.imageWidth }
      : {}),
    ...(typeof data.imageHeight === "number"
      ? { imageHeight: data.imageHeight }
      : {}),
    ...(typeof data.pageCount === "number"
      ? { pageCount: data.pageCount }
      : {}),
  };
}

function formatFileSize(size: number | undefined): string | undefined {
  if (!Number.isFinite(size) || size === undefined || size < 0)
    return undefined;
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

type PropertiesPanelProps = {
  labels: WhiteboardLabels;
  node: CanvasFlowNode | null;
  sourceState?: SourceResolutionState;
  position?: { x: number; y: number; width?: number; height?: number };
  onClose?: () => void;
  onOpen: (node: CanvasFlowNode) => void;
  onRefreshSource: (node: CanvasFlowNode) => void;
  onViewAnnotations: (node: CanvasFlowNode) => void;
  viewAnnotationsRef?: Ref<HTMLButtonElement>;
  onRemoveFromGroup?: (nodeId: string) => void;
  onCopy: (nodeId: string) => void;
  onJoinGroup?: (nodeId: string) => void;
  groupTitle?: string;
  onDelete: (nodeId: string) => void;
  noteTemplates?: NoteTemplate[];
  onBadgeChange?: (nodeId: string, badge: string) => void;
  onTypeChange?: (nodeId: string, type: NoteType) => void;
  onApplyTemplate?: (nodeId: string, templateId: string) => void;
  onSaveTemplate?: (
    nodeId: string,
    name: string,
    includeContent: boolean,
  ) => void;
  onRenameTemplate?: (templateId: string, name: string) => void;
  onDuplicateTemplate?: (templateId: string) => void;
  onDeleteTemplate?: (templateId: string) => void;
};

function PropertiesPanelView(
  props: PropertiesPanelProps & {
    panelRef?: Ref<HTMLElement>;
    placement?: PanelPlacement | null;
  },
) {
  const { node, labels } = props;
  if (!node) return null;
  const model = node.data.model;
  const hasSource =
    model.kind === "literature" ||
    model.kind === "quote" ||
    (model.kind === "note" && !!model.source) ||
    ("data" in model && "source" in model.data && !!model.data.source);
  const kindLabel = nodeKindLabel(labels, model.kind);
  const data = "data" in model ? model.data : undefined;
  const fileDetails = fileDetailsForNode(node);
  const hasEmbeddedFile = Boolean(fileDetails?.fileData);
  const canOpen = !!(
    data &&
    (hasEmbeddedFile ||
      ("source" in data && data.source) ||
      ("itemID" in data && data.itemID) ||
      ("attachmentID" in data && data.attachmentID))
  );
  const subtitle =
    model.kind === "note" && model.sourceSnapshot?.title
      ? model.sourceSnapshot.title
      : data && "subtitle" in data && typeof data.subtitle === "string"
        ? data.subtitle
        : undefined;
  const sourceStatus =
    props.sourceState?.status === "unavailable"
      ? labels.sourceMissing
      : props.sourceState?.status === "loading"
        ? labels.sourceLoading
        : props.sourceState?.status === "resolved"
          ? labels.sourceAvailable
          : labels.sourceIdle;
  const frameId = "frameId" in model ? model.frameId : undefined;
  const positionStyle = props.position
    ? ({
        "--zmd-properties-left": `${props.placement?.left ?? props.position.x}px`,
        "--zmd-properties-top": `${props.placement?.top ?? props.position.y}px`,
        ...(props.placement
          ? {
              "--zmd-properties-width": `${props.placement.width}px`,
              "--zmd-properties-max-height": `${props.placement.maxHeight}px`,
            }
          : {}),
      } as CSSProperties)
    : undefined;

  return (
    <aside
      ref={props.panelRef}
      key={node.id}
      className={`zmd-board-properties is-expanded${props.position ? " is-positioned" : ""}`}
      data-placement={props.placement?.side}
      aria-label={labels.selection}
      style={positionStyle}
    >
      <header className="zmd-board-properties-head">
        <div>
          <span className="zmd-board-card-kind">{kindLabel}</span>
          <h2>
            {propertiesLabel(labels, "selectionDetails", labels.selection)}
          </h2>
        </div>
        {props.onClose ? (
          <button
            type="button"
            className="zmd-board-properties-close"
            aria-label={labels.close}
            title={labels.close}
            onClick={() => props.onClose?.()}
          >
            ×
          </button>
        ) : null}
      </header>
      <div
        className="zmd-board-properties-actions"
        aria-label={labels.selection}
      >
        {hasSource ? (
          <button type="button" onClick={() => props.onOpen(node)}>
            <IconOpen />
            <span>
              {hasEmbeddedFile
                ? fileLabel(labels, "fileOpen", "Open file")
                : labels.openSource}
            </span>
          </button>
        ) : canOpen ? (
          <button type="button" onClick={() => props.onOpen(node)}>
            <IconOpen />
            <span>
              {hasEmbeddedFile
                ? fileLabel(labels, "fileOpen", "Open file")
                : labels.openItem}
            </span>
          </button>
        ) : null}
        {model.kind === "literature" ? (
          <button
            ref={props.viewAnnotationsRef}
            type="button"
            onClick={() => props.onViewAnnotations(node)}
          >
            <IconOpen />
            <span>{labels.viewAnnotations}</span>
          </button>
        ) : null}
        {model.kind !== "frame" && props.onJoinGroup ? (
          <button type="button" onClick={() => props.onJoinGroup?.(node.id)}>
            <IconOpen />
            <span>{labels.joinGroup ?? "Join group"}</span>
          </button>
        ) : null}
        {frameId !== undefined && props.onRemoveFromGroup ? (
          <button
            type="button"
            onClick={() => props.onRemoveFromGroup?.(node.id)}
          >
            <IconOpen />
            <span>
              {propertiesLabel(labels, "removeFromGroup", labels.delete)}
            </span>
          </button>
        ) : null}
      </div>
      <div className="zmd-board-properties-details-body">
        <div className="zmd-board-properties-details-meta">
          <strong>{flowNodeText(node) || kindLabel}</strong>
          {props.groupTitle ? (
            <p>
              {labels.groupLabel ?? "Group"}: {props.groupTitle}
            </p>
          ) : null}
          {subtitle ? <p>{subtitle}</p> : null}
          {hasSource ? (
            <p
              className="zmd-board-source-status"
              data-source-status={props.sourceState?.status ?? "idle"}
            >
              {labels.sourceStatus}: {sourceStatus}
            </p>
          ) : null}
        </div>
        {fileDetails ? (
          <section
            className="zmd-board-file-details"
            aria-label={fileLabel(labels, "fileDetails", "File details")}
          >
            <h3>{fileLabel(labels, "fileDetails", "File details")}</h3>
            <dl>
              <dt>Name</dt>
              <dd>{fileDetails.title}</dd>
              {fileDetails.contentType ? (
                <>
                  <dt>MIME</dt>
                  <dd>{fileDetails.contentType}</dd>
                </>
              ) : null}
              {formatFileSize(fileDetails.size) ? (
                <>
                  <dt>Size</dt>
                  <dd>{formatFileSize(fileDetails.size)}</dd>
                </>
              ) : null}
              {fileDetails.imageWidth && fileDetails.imageHeight ? (
                <>
                  <dt>{fileLabel(labels, "fileDimensions", "Dimensions")}</dt>
                  <dd>
                    {fileDetails.imageWidth} × {fileDetails.imageHeight}
                  </dd>
                </>
              ) : null}
              {fileDetails.pageCount ? (
                <>
                  <dt>{fileLabel(labels, "filePages", "Pages")}</dt>
                  <dd>{fileDetails.pageCount}</dd>
                </>
              ) : null}
            </dl>
          </section>
        ) : null}
        {model.kind === "note" && props.noteTemplates ? (
          <NoteTemplateControls
            labels={labels}
            note={model}
            templates={props.noteTemplates}
            onTypeChange={(type) => props.onTypeChange?.(node.id, type)}
            onBadgeChange={(badge) => props.onBadgeChange?.(node.id, badge)}
            onApply={(templateId) =>
              props.onApplyTemplate?.(node.id, templateId)
            }
            onSave={(name, includeContent) =>
              props.onSaveTemplate?.(node.id, name, includeContent)
            }
            onRename={(templateId, name) =>
              props.onRenameTemplate?.(templateId, name)
            }
            onDuplicate={(templateId) =>
              props.onDuplicateTemplate?.(templateId)
            }
            onDelete={(templateId) => props.onDeleteTemplate?.(templateId)}
          />
        ) : null}
        <div className="zmd-board-properties-advanced-actions">
          {model.kind === "note" && model.source ? (
            <button type="button" onClick={() => props.onRefreshSource(node)}>
              <IconOpen />
              <span>{labels.refreshNote}</span>
            </button>
          ) : null}
          {model.kind === "literature" || model.kind === "quote" ? (
            <button type="button" onClick={() => props.onRefreshSource(node)}>
              <IconOpen />
              <span>{labels.refreshSource}</span>
            </button>
          ) : null}
          <button type="button" onClick={() => props.onCopy(node.id)}>
            <IconCopy />
            <span>{labels.copy}</span>
          </button>
          <button type="button" onClick={() => props.onDelete(node.id)}>
            <IconTrash />
            <span>{labels.delete}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function PropertiesPanelContent(
  props: PropertiesPanelProps & { node: CanvasFlowNode },
) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  useLayoutEffect(() => {
    panelRef.current
      ?.querySelector<HTMLButtonElement>(".zmd-board-properties-close")
      ?.focus({ preventScroll: true });
  }, []);
  const positionX = props.position?.x;
  const positionY = props.position?.y;
  const anchorWidth = props.position?.width ?? 0;
  const anchorHeight = props.position?.height ?? 0;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || positionX === undefined || positionY === undefined) {
      setPlacement(null);
      return;
    }

    const host = panel.offsetParent ?? panel.parentElement;
    const toolbar = host?.querySelector(".zmd-board-style-bar.is-selection");
    const measure = () => {
      const hostRect = host?.getBoundingClientRect();
      const hostLeft = hostRect?.left ?? 0;
      const hostTop = hostRect?.top ?? 0;
      const hostWidth =
        hostRect?.width || host?.clientWidth || window.innerWidth || 1024;
      const hostHeight =
        hostRect?.height || host?.clientHeight || window.innerHeight || 768;
      const hostRight = hostRect?.right || hostLeft + hostWidth;
      const hostBottom = hostRect?.bottom || hostTop + hostHeight;
      const viewportLeft = Math.max(0, hostLeft);
      const viewportTop = Math.max(0, hostTop);
      const viewportRight = Math.min(window.innerWidth || hostRight, hostRight);
      const viewportBottom = Math.min(
        window.innerHeight || hostBottom,
        hostBottom,
      );
      const panelRect = panel.getBoundingClientRect();
      const toolbarRect = toolbar?.getBoundingClientRect();
      const next = placePropertiesPanel(
        {
          x: positionX - hostLeft,
          y: positionY - hostTop,
          width: anchorWidth,
          height: anchorHeight,
        },
        {
          width: 420,
          height: panel.scrollHeight
            ? panel.scrollHeight + 2
            : panelRect.height || 40,
        },
        {
          x: viewportLeft - hostLeft,
          y: viewportTop - hostTop,
          width: viewportRight - viewportLeft,
          height: viewportBottom - viewportTop,
        },
        true,
        toolbarRect
          ? {
              x: toolbarRect.left - hostLeft,
              y: toolbarRect.top - hostTop,
              width: toolbarRect.width,
              height: toolbarRect.height,
            }
          : undefined,
      );
      setPlacement((current) =>
        current?.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight &&
        current.side === next.side
          ? current
          : next,
      );
    };
    measure();
    // The sibling toolbar may reposition in its own layout effect.
    let frame = window.requestAnimationFrame(measure);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(panel);
    if (toolbar) resizeObserver?.observe(toolbar);
    if (host) resizeObserver?.observe(host);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [props.node.id, positionX, positionY, anchorWidth, anchorHeight]);
  return (
    <PropertiesPanelView {...props} panelRef={panelRef} placement={placement} />
  );
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  if (!props.node) return null;
  if (!props.position) return PropertiesPanelView(props);
  return (
    <PropertiesPanelContent key={props.node.id} {...props} node={props.node} />
  );
}
