import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_IMAGE_BYTES,
  buildAssetFilename,
  bytesToDataUrl,
  externalImageReferences,
  mimeFromAssetPath,
  normalizeAssetReference,
  parseMarkdownImages,
  planUnusedImageCleanup,
  referencedAssets,
  validateImageInput,
} from "../src/modules/markdown/images/model";

test("validates supported image formats and size", () => {
  assert.equal(validateImageInput("image/jpeg", 12), "jpg");
  assert.throws(() => validateImageInput("image/svg+xml", 12), /仅支持/);
  assert.throws(
    () => validateImageInput("image/png", MAX_IMAGE_BYTES + 1),
    /15 MB/,
  );
});

test("builds path-safe generated asset names", () => {
  assert.equal(
    buildAssetFilename("png", 1723500000000, 0),
    "1723500000000-0000000.png",
  );
});

test("normalizes only local asset references", () => {
  assert.equal(normalizeAssetReference("assets/a.png"), "assets/a.png");
  assert.equal(
    normalizeAssetReference("zotero-md://asset/a.webp"),
    "assets/a.webp",
  );
  assert.equal(normalizeAssetReference("assets/../secret.png"), null);
  assert.equal(normalizeAssetReference("/assets/a.png"), null);
  assert.equal(normalizeAssetReference("https://example.com/a.png"), null);
  assert.equal(mimeFromAssetPath("assets/a.JPEG"), "image/jpeg");
});

test("parses markdown images and deduplicates local assets", () => {
  const source =
    "![封面](assets/a.png) and ![](https://x/y.png)\n![again](assets/a.png)";
  assert.deepEqual(
    parseMarkdownImages(source).map(({ alt, source }) => ({ alt, source })),
    [
      { alt: "封面", source: "assets/a.png" },
      { alt: "", source: "https://x/y.png" },
      { alt: "again", source: "assets/a.png" },
    ],
  );
  assert.deepEqual(referencedAssets(source), ["assets/a.png"]);
});

test("encodes image bytes as a data URL", () => {
  assert.equal(
    bytesToDataUrl(new Uint8Array([0x66, 0x6f, 0x6f]), "image/png"),
    "data:image/png;base64,Zm9v",
  );
});

test("identifies external images without treating local assets as downloads", () => {
  const refs = externalImageReferences(
    "![remote](https://example.com/a.png) ![local](assets/a.png) ![other](http://x/y.webp)",
  );
  assert.deepEqual(
    refs.map((ref) => ref.source),
    ["https://example.com/a.png", "http://x/y.webp"],
  );
});

test("plans unused image cleanup and removes only an empty assets directory", () => {
  assert.deepEqual(
    planUnusedImageCleanup(
      ["assets/used.png", "assets/unused.webp"],
      "![used](assets/used.png)",
    ),
    { remove: ["assets/unused.webp"], removeDirectory: false },
  );
  assert.deepEqual(planUnusedImageCleanup(["assets/unused.png"], ""), {
    remove: ["assets/unused.png"],
    removeDirectory: true,
  });
  assert.deepEqual(
    planUnusedImageCleanup(["assets/unused.png", "assets/readme.txt"], ""),
    { remove: ["assets/unused.png"], removeDirectory: false },
  );
});
