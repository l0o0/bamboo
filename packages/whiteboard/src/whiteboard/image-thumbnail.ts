export const IMAGE_THUMBNAIL_EDGE = 1024;
export const IMAGE_THUMBNAIL_BYTES = 256 * 1024;
const IMAGE_LOAD_TIMEOUT_MS = 10_000;
const IMAGE_ENCODE_TIMEOUT_MS = 5_000;

export interface ImageThumbnail {
  width?: number;
  height?: number;
  image?: string;
}

export function thumbnailDimensions(
  width: number,
  height: number,
): { width: number; height: number } | undefined {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return undefined;
  const ratio = Math.min(1, IMAGE_THUMBNAIL_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), IMAGE_ENCODE_TIMEOUT_MS);
    try {
      // WebP preserves transparency. Browsers without its encoder return PNG.
      canvas.toBlob(
        (blob) => {
          clearTimeout(timer);
          resolve(blob ?? undefined);
        },
        "image/webp",
        0.82,
      );
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

function blobDataUrl(blob: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.onabort = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

async function makeImageThumbnail(dataUrl: string): Promise<ImageThumbnail> {
  if (typeof Image === "undefined") return {};
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), IMAGE_LOAD_TIMEOUT_MS);
      image.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      image.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      image.src = dataUrl;
    });
    if (!loaded) return {};
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const target = thumbnailDimensions(width, height);
    if (!target) return {};
    const result: ImageThumbnail = { width, height };
    if (
      typeof document === "undefined" ||
      (width <= IMAGE_THUMBNAIL_EDGE &&
        height <= IMAGE_THUMBNAIL_EDGE &&
        dataUrl.length <= 4 * Math.ceil(IMAGE_THUMBNAIL_BYTES / 3))
    )
      return result;
    canvas = document.createElement("canvas");
    // Encoding yields to the browser. Only one image is decoded/encoded at a
    // time, including imports started by separate drop/paste actions.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      canvas.width = Math.max(1, Math.round(target.width / 2 ** attempt));
      canvas.height = Math.max(1, Math.round(target.height / 2 ** attempt));
      const context = canvas.getContext("2d");
      if (!context) return result;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await encodeCanvas(canvas);
      if (!blob) return result;
      if (blob.size > IMAGE_THUMBNAIL_BYTES) continue;
      if (!["image/webp", "image/png"].includes(blob.type)) return result;
      result.image = await blobDataUrl(blob);
      return result;
    }
    return result;
  } catch {
    // Thumbnail generation never prevents retaining the original attachment.
    return {};
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = "";
    if (canvas) canvas.width = canvas.height = 1;
  }
}

let thumbnailQueue: Promise<unknown> = Promise.resolve();

/** SVG is deliberately excluded; keep its inert original bytes for export. */
export function createImageThumbnail(dataUrl: string): Promise<ImageThumbnail> {
  if (!/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(dataUrl)) {
    return Promise.resolve({});
  }
  const next = thumbnailQueue.then(() => makeImageThumbnail(dataUrl));
  thumbnailQueue = next.catch(() => undefined);
  return next;
}
