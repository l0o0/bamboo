import type { NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { useWhiteboardLabels } from "../chrome/labels";
import {
  inferAttachmentContentType,
  isSafeImagePreview,
} from "../model/file-attachment";
import { nodeTextStyle } from "../whiteboard/document";
import { IconFile } from "../whiteboard/icons";
import { originalImagePreview } from "../whiteboard/file-import";
import { useFullCanvasRender } from "../whiteboard/rendering";
import { CardShell } from "./CardShell";
import type { CanvasFlowNode } from "./types";

export function ItemNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const model = data.model;
  if (model.kind !== "item") return null;
  return (
    <CardShell
      kind="item"
      kindLabel={labels.addItem}
      selected={selected}
      nodeStyle={model.style}
    >
      <h3
        className="zmd-board-card-title"
        style={nodeTextStyle(model.style ?? {})}
      >
        {model.data.title}
      </h3>
      {model.data.subtitle ? (
        <p className="zmd-board-card-meta">{model.data.subtitle}</p>
      ) : null}
    </CardShell>
  );
}

export function PdfNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const fullRender = useFullCanvasRender();
  const model = data.model;
  const image = model.kind === "pdf" ? model.data.image : undefined;
  const fileData = model.kind === "pdf" ? model.data.fileData : undefined;
  const imageContentType =
    model.kind === "pdf" ? model.data.contentType : undefined;
  const imagePreview = useMemo(
    () =>
      fullRender
        ? originalImagePreview(image, fileData, imageContentType)
        : previewImage(image, fileData),
    [image, fileData, imageContentType, fullRender],
  );
  if (model.kind !== "pdf") return null;
  const contentType =
    model.data.contentType?.split(";", 1)[0]?.toLowerCase() ||
    inferAttachmentContentType(model.data.title);
  const imageOnly =
    Boolean(model.data.image) && contentType.startsWith("image/");
  const kindLabel = imageOnly
    ? ((labels as unknown as Record<string, unknown>).fileImage as string) ||
      "Image"
    : labels.addPdf;
  const unavailableLabel =
    ((labels as unknown as Record<string, unknown>)
      .fileUnavailable as string) || labels.attachmentNotDownloaded;
  return (
    <CardShell
      kind="pdf"
      kindLabel={kindLabel}
      kindIcon={<IconFile />}
      showKindLabel={false}
      selected={selected}
      nodeStyle={model.style}
    >
      {imagePreview ? (
        <img
          className="zmd-board-pdf-image"
          src={imagePreview}
          alt={model.data.title || labels.addPdf}
          loading={fullRender ? "eager" : "lazy"}
          decoding="async"
          onError={(event) => {
            const original = originalImagePreview(
              undefined,
              fileData,
              imageContentType,
            );
            if (original && event.currentTarget.src !== original)
              event.currentTarget.src = original;
          }}
        />
      ) : model.data.source ? null : (
        <div className="zmd-board-pdf-page" aria-hidden="true">
          <span>{model.data.pdfPage ? model.data.pdfPage : labels.addPdf}</span>
        </div>
      )}
      <h3
        className="zmd-board-card-title"
        style={nodeTextStyle(model.style ?? {})}
      >
        {model.data.title}
      </h3>
      {model.data.subtitle || model.data.contentType ? (
        <p className="zmd-board-card-meta">
          {model.data.subtitle || model.data.contentType}
        </p>
      ) : null}
      {model.data.availability === "not-downloaded" ? (
        <p className="zmd-board-card-meta">{unavailableLabel}</p>
      ) : null}
    </CardShell>
  );
}

export function AttachmentNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const labels = useWhiteboardLabels();
  const fullRender = useFullCanvasRender();
  const model = data.model;
  const image = model.kind === "attachment" ? model.data.image : undefined;
  const fileData =
    model.kind === "attachment" ? model.data.fileData : undefined;
  const imageContentType =
    model.kind === "attachment" ? model.data.contentType : undefined;
  const imagePreview = useMemo(
    () =>
      fullRender
        ? originalImagePreview(image, fileData, imageContentType)
        : previewImage(image, fileData),
    [image, fileData, imageContentType, fullRender],
  );
  if (model.kind !== "attachment") return null;
  const contentType =
    model.data.contentType?.split(";", 1)[0]?.toLowerCase() ||
    inferAttachmentContentType(model.data.title);
  const kind = attachmentKind(contentType);
  const preview = model.data.preview?.slice(0, 600);
  const label = (key: string, fallback: string): string => {
    const value = (labels as unknown as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : fallback;
  };
  const details = [
    kind === "generic" ? model.data.contentType : undefined,
    formatAttachmentSize(model.data.size),
    model.data.pageCount
      ? `${label("filePages", "Pages")}: ${model.data.pageCount}`
      : undefined,
    model.data.imageWidth && model.data.imageHeight
      ? `${label("fileDimensions", "Dimensions")}: ${model.data.imageWidth} × ${model.data.imageHeight}`
      : undefined,
  ].filter(Boolean);
  const kindLabel = attachmentKindLabel(kind, label);
  const metadata = details.length
    ? `${label("fileDetails", "Details")}: ${details.join(" · ")}`
    : model.data.subtitle;
  return (
    <CardShell
      kind="attachment"
      kindLabel={kindLabel}
      kindIcon={<IconFile />}
      showKindLabel={false}
      selected={selected}
      nodeStyle={model.style}
    >
      <h3
        className="zmd-board-card-title"
        style={nodeTextStyle(model.style ?? {})}
      >
        {model.data.title}
      </h3>
      {imagePreview ? (
        <img
          className="zmd-board-pdf-image"
          src={imagePreview}
          alt={model.data.title || label("fileImage", "Image")}
          loading={fullRender ? "eager" : "lazy"}
          decoding="async"
          onError={(event) => {
            const original = originalImagePreview(
              undefined,
              fileData,
              imageContentType,
            );
            if (original && event.currentTarget.src !== original)
              event.currentTarget.src = original;
          }}
        />
      ) : null}
      {metadata ? <p className="zmd-board-card-meta">{metadata}</p> : null}
      {model.data.availability === "not-downloaded" ? (
        <p className="zmd-board-card-meta">
          {label("fileUnavailable", labels.attachmentNotDownloaded)}
        </p>
      ) : null}
      {preview && kind === "text" ? (
        <p
          className="zmd-board-attachment-preview"
          style={nodeTextStyle(model.style ?? {})}
        >
          <span className="zmd-board-card-meta">
            {label("filePreview", "Preview")}
          </span>
          {preview}
        </p>
      ) : null}
    </CardShell>
  );
}

function attachmentKindLabel(
  kind: AttachmentKind,
  label: (key: string, fallback: string) => string,
): string {
  switch (kind) {
    case "image":
      return label("fileImage", "Image");
    case "pdf":
      return label("filePdf", "PDF");
    case "text":
      return label("fileText", "Text");
    case "audio":
      return label("fileAudio", "Audio");
    case "video":
      return label("fileVideo", "Video");
    case "archive":
      return label("fileArchive", "Archive");
    case "generic":
      return label("fileGeneric", "File");
  }
}

type AttachmentKind =
  "image" | "pdf" | "text" | "audio" | "video" | "archive" | "generic";

function attachmentKind(contentType: string | undefined): AttachmentKind {
  if (contentType === "application/pdf") return "pdf";
  if (contentType?.startsWith("image/")) return "image";
  if (
    contentType?.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/javascript"
  ) {
    return "text";
  }
  if (contentType?.startsWith("audio/")) return "audio";
  if (contentType?.startsWith("video/")) return "video";
  if (
    contentType === "application/zip" ||
    contentType === "application/x-7z-compressed" ||
    contentType === "application/x-rar-compressed" ||
    contentType === "application/gzip" ||
    contentType === "application/x-bzip2" ||
    contentType === "application/x-xz" ||
    contentType === "application/x-tar"
  ) {
    return "archive";
  }
  return "generic";
}

function formatAttachmentSize(size: number | undefined): string | undefined {
  if (!Number.isFinite(size) || size === undefined || size < 0)
    return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function previewImage(
  image: string | undefined,
  fileData: string | undefined,
): string | undefined {
  if (image && isSafeImagePreview(image)) return image;
  return fileData && isSafeImagePreview(fileData) ? fileData : undefined;
}
