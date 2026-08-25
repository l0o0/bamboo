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
  replaceMarkdownRange,
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
  assert.equal(normalizeAssetReference("./assets/a.png"), "assets/a.png");
  assert.equal(normalizeAssetReference("assets/../secret.png"), null);
  assert.equal(normalizeAssetReference("../assets/a.png"), null);
  assert.equal(normalizeAssetReference("/assets/a.png"), null);
  assert.equal(normalizeAssetReference("https://example.com/a.png"), null);
  assert.equal(mimeFromAssetPath("assets/a.JPEG"), "image/jpeg");
});

test("replaces a markdown range by offset instead of first-match", () => {
  const source = "![a](https://x/a.png) ![a](https://x/a.png)";
  const second = source.lastIndexOf("![a]");
  assert.equal(
    replaceMarkdownRange(source, second, source.length, "![a](assets/a.png)"),
    "![a](https://x/a.png) ![a](assets/a.png)",
  );
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

test("parses angle-bracket destinations and keeps positions in order", () => {
  const source =
    '![one](<assets/my image.png>)\n![two](assets/b.png) ![three](<assets/c.png> "title")';
  const images = parseMarkdownImages(source);
  assert.deepEqual(
    images.map(({ alt, source }) => ({ alt, source })),
    [
      { alt: "one", source: "assets/my image.png" },
      { alt: "two", source: "assets/b.png" },
      { alt: "three", source: "assets/c.png" },
    ],
  );
  // Offsets stay sorted so replaceMarkdownRange can apply last-to-first.
  assert.ok(images[0].from < images[1].from && images[1].from < images[2].from);
  assert.deepEqual(referencedAssets(source), [
    "assets/my image.png",
    "assets/b.png",
    "assets/c.png",
  ]);
});

test("counts relative and wikilink references as used assets", () => {
  const source =
    "![](./assets/rel.png)\n![[Pasted image.png]]\n![a](<assets/space name.png>)";
  assert.deepEqual(referencedAssets(source), [
    "assets/rel.png",
    "assets/space name.png",
    "assets/Pasted image.png",
  ]);
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

test("cleanup only ever removes plugin-generated asset files", () => {
  const generated = "assets/1723500000000-abc1234.png";
  const used = "assets/1723500000001-def5678.webp";
  const userManaged = "assets/my image.png";
  const userManaged2 = "assets/Pasted image.png";
  const readme = "assets/readme.txt";

  // Unreferenced generated files are removed; user-managed files survive
  // even when they look unreferenced (their reference syntax may be
  // unrecognized by the parser, e.g. wikilinks or spaces).
  assert.deepEqual(
    planUnusedImageCleanup([generated, userManaged, userManaged2], ""),
    { remove: [generated], removeDirectory: false },
  );
  // Non-image files are never removed.
  assert.deepEqual(planUnusedImageCleanup([readme], ""), {
    remove: [],
    removeDirectory: false,
  });
  // Referenced generated files are kept.
  assert.deepEqual(planUnusedImageCleanup([generated, used], `![a](${used})`), {
    remove: [generated],
    removeDirectory: false,
  });
  // Only generated files present → the empty assets directory is removed.
  assert.deepEqual(planUnusedImageCleanup([generated], ""), {
    remove: [generated],
    removeDirectory: true,
  });
  // Generated files referenced via unusual syntax are still protected.
  assert.deepEqual(
    planUnusedImageCleanup(
      [generated, used],
      `![a](<${generated}>) ![[${used.slice("assets/".length)}]]`,
    ),
    { remove: [], removeDirectory: false },
  );
});
