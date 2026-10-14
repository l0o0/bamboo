import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  createImageThumbnail,
  IMAGE_THUMBNAIL_BYTES,
  thumbnailDimensions,
} from "../packages/whiteboard/src/whiteboard/image-thumbnail.ts";
import {
  importWhiteboardFiles,
  originalImagePreview,
} from "../packages/whiteboard/src/whiteboard/file-import.ts";
import {
  buildCanvasMarkdown,
  buildCanvasSvg,
} from "../packages/whiteboard/src/whiteboard/export.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";

function imageBrowser(
  t: TestContext,
  options: {
    width?: number;
    height?: number;
    sizes?: number[];
    failLoad?: boolean;
    failEncode?: boolean;
  } = {},
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(
    ["Image", "document", "FileReader"].map((key) => [key, globals[key]]),
  );
  t.after(() => Object.assign(globals, previous));
  const dimensions: { width: number; height: number }[] = [];
  let active = 0;
  let peak = 0;
  let encodes = 0;
  class MockImage {
    naturalWidth = options.width ?? 4000;
    naturalHeight = options.height ?? 3000;
    onload?: (() => void) | null;
    onerror?: (() => void) | null;
    set src(value: string) {
      if (!value) {
        active -= 1;
        return;
      }
      active += 1;
      peak = Math.max(peak, active);
      queueMicrotask(() =>
        options.failLoad ? this.onerror?.() : this.onload?.(),
      );
    }
  }
  class Reader {
    result: string | null = null;
    onload?: () => void;
    onerror?: () => void;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(
        (bytes) => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onload?.();
        },
        () => this.onerror?.(),
      );
    }
  }
  Object.assign(globals, {
    Image: MockImage,
    FileReader: Reader,
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage: (
              _image: unknown,
              _x: number,
              _y: number,
              width: number,
              height: number,
            ) => dimensions.push({ width, height }),
          };
        },
        toBlob(callback: (blob: Blob | null) => void) {
          const size = options.sizes?.[encodes++] ?? 32;
          setTimeout(
            () =>
              callback(
                options.failEncode
                  ? null
                  : new Blob([new Uint8Array(size)], { type: "image/webp" }),
              ),
            0,
          );
        },
      }),
    },
  });
  return { dimensions, peak: () => peak, active: () => active };
}

test("thumbnail dimensions bound portrait, landscape and narrow images without upscaling", () => {
  assert.deepEqual(thumbnailDimensions(4000, 3000), {
    width: 1024,
    height: 768,
  });
  assert.deepEqual(thumbnailDimensions(3000, 4000), {
    width: 768,
    height: 1024,
  });
  assert.deepEqual(thumbnailDimensions(100_000, 1), { width: 1024, height: 1 });
  assert.deepEqual(thumbnailDimensions(40, 30), { width: 40, height: 30 });
  assert.equal(thumbnailDimensions(0, 20), undefined);
  assert.equal(thumbnailDimensions(Infinity, 20), undefined);
});

test("image imports keep original bytes and dimensions alongside a bounded thumbnail", async (t) => {
  const browser = imageBrowser(t);
  const original = new File(["original GIF bytes"], "animation.gif", {
    type: "image/gif",
  });
  const result = await importWhiteboardFiles([original]);
  assert.equal(result.failures.length, 0);
  const file = result.files[0]!;
  assert.equal(
    file.fileData,
    `data:image/gif;base64,${Buffer.from("original GIF bytes").toString("base64")}`,
  );
  assert.equal(file.imageWidth, 4000);
  assert.equal(file.imageHeight, 3000);
  assert.match(file.image!, /^data:image\/webp;base64,/);
  assert.deepEqual(browser.dimensions, [{ width: 1024, height: 768 }]);
  assert.equal(
    originalImagePreview(file.image, file.fileData, file.contentType),
    file.fileData,
  );
  assert.equal(browser.active(), 0);
});

test("thumbnail jobs from concurrent imports never decode images concurrently", async (t) => {
  const browser = imageBrowser(t);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      createImageThumbnail("data:image/png;base64,eA=="),
    ),
  );
  assert.equal(results.length, 4);
  assert.equal(browser.peak(), 1);
  assert.equal(browser.active(), 0);
});

test("oversized thumbnails reduce dimensions and enforce the encoded byte ceiling", async (t) => {
  const browser = imageBrowser(t, { sizes: [IMAGE_THUMBNAIL_BYTES + 1, 100] });
  const result = await createImageThumbnail("data:image/png;base64,eA==");
  assert.deepEqual(browser.dimensions, [
    { width: 1024, height: 768 },
    { width: 512, height: 384 },
  ]);
  assert.equal(
    Buffer.from(result.image!.split(",")[1]!, "base64").byteLength,
    100,
  );
});

test("thumbnail encode failure preserves imports and falls back to original data", async (t) => {
  imageBrowser(t, { failEncode: true });
  const result = await importWhiteboardFiles([
    new File(["original"], "photo.jpg", { type: "image/jpeg" }),
  ]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.files[0]?.image, undefined);
  assert.equal(result.files[0]?.imageWidth, 4000);
  assert.equal(
    originalImagePreview(undefined, result.files[0]?.fileData, "image/jpeg"),
    result.files[0]?.fileData,
  );
});

test("thumbnail load failure and SVG imports retain original attachments", async (t) => {
  const browser = imageBrowser(t, { failLoad: true });
  const result = await importWhiteboardFiles([
    new File(["broken"], "broken.jpg", { type: "image/jpeg" }),
    new File(["<svg onload='danger()'></svg>"], "original.svg", {
      type: "image/svg+xml",
    }),
  ]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.files.length, 2);
  assert.ok(result.files.every((file) => file.fileData && !file.image));
  assert.equal(browser.dimensions.length, 0);
  assert.equal(browser.active(), 0);
  assert.equal(
    originalImagePreview(undefined, result.files[1]?.fileData, "image/svg+xml"),
    undefined,
  );
});

test("small images avoid duplicate thumbnails and legacy image-only cards still open", async (t) => {
  const browser = imageBrowser(t, { width: 64, height: 48 });
  const original = "data:image/png;base64,eA==";
  const result = await createImageThumbnail(original);
  assert.deepEqual(result, { width: 64, height: 48 });
  assert.equal(browser.dimensions.length, 0);
  assert.equal(originalImagePreview(original, undefined, undefined), original);
  assert.equal(
    originalImagePreview(
      original,
      "data:application/pdf;base64,eA==",
      "application/pdf",
    ),
    original,
  );
});

test("canvas persistence and exports retain original image quality when a thumbnail exists", () => {
  const original = "data:image/png;base64,b3JpZ2luYWw=";
  const thumbnail = "data:image/webp;base64,dGh1bWI=";
  const document: CanvasDocument = {
    version: 2,
    nodes: [
      {
        id: "image",
        kind: "attachment",
        position: { x: 0, y: 0 },
        width: 240,
        height: 220,
        data: {
          title: "original.png",
          contentType: "image/png",
          size: 8,
          fileData: original,
          image: thumbnail,
          imageWidth: 4000,
          imageHeight: 3000,
        },
      },
    ],
    connections: [],
  };
  const parsed = canvasFileToDocument(canvasDocumentToFile(document));
  assert.deepEqual(parsed.issues, []);
  const model = parsed.document.nodes[0]!;
  assert.equal(model.kind, "attachment");
  if (model.kind !== "attachment") return;
  assert.equal(model.data.fileData, original);
  assert.equal(model.data.image, thumbnail);
  const svg = buildCanvasSvg(parsed.document);
  const markdown = buildCanvasMarkdown(parsed.document);
  assert.ok(svg.includes(original));
  assert.ok(markdown.includes(original));
  assert.ok(!svg.includes(thumbnail));
  assert.ok(!markdown.includes(thumbnail));
});
