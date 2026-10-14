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
  assert.deepEqual(
    new Set(referencedAssets(source)),
    new Set([
      "assets/rel.png",
      "assets/space name.png",
      "assets/Pasted image.png",
    ]),
  );
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

test("cleanup retains reference-style images with full, collapsed and shortcut labels", () => {
  const full = "assets/1723500000000-abc1234.png";
  const collapsed = "assets/1723500000001-def5678.webp";
  const shortcut = "assets/1723500000002-ghi9012.jpg";
  const orphan = "assets/1723500000003-jkl3456.png";
  const source = `![figure][FIGURE]\n![Collapsed][]\n![Shortcut]\n
[figure]: ${full} "Full reference title"
[collapsed]: <./${collapsed}> 'Collapsed reference title'
[shortcut]:
  <${shortcut}>
  (Shortcut reference title)
`;

  assert.deepEqual(referencedAssets(source), [full, collapsed, shortcut]);
  assert.deepEqual(
    planUnusedImageCleanup([full, collapsed, shortcut, orphan], source),
    { remove: [orphan], removeDirectory: false },
  );
});

test("cleanup conservatively retains unused local definitions and spaced destinations", () => {
  const asset = "assets/1723500000000-abc1234.png";
  const alternate = "assets/1723500000001-def5678.webp";
  const source = `[unused]: ${asset}
[unused]: ${alternate} "Duplicate labels may still be edited later"
[spaced label]: <./assets/my image.png> "An optional title"
[encoded]: assets/1723500000000%2Dabc1234.png
[literal percent]: <assets/my%image.png>
`;

  assert.deepEqual(referencedAssets(source), [
    asset,
    alternate,
    "assets/my image.png",
    "assets/1723500000000%2Dabc1234.png",
    "assets/my%image.png",
  ]);
  assert.deepEqual(planUnusedImageCleanup([asset, alternate], source), {
    remove: [],
    removeDirectory: false,
  });
});

test("cleanup retains assets referenced through CommonMark destination escapes", () => {
  const asset = "assets/1723500000000-abc1234.png";
  for (const destination of [
    "assets/1723500000000\\-abc1234.png",
    "assets/1723500000000&#45;abc1234.png",
    "assets/1723500000000&#x2d;abc1234.png",
    "assets/1723500000000-abc1234&period;png",
  ]) {
    const source = `![figure][img]\n\n[img]: ${destination}\n`;
    assert.ok(referencedAssets(source).includes(asset), destination);
    assert.deepEqual(planUnusedImageCleanup([asset], source), {
      remove: [],
      removeDirectory: false,
    });
  }
});

test("cleanup retains reference definitions inside quotes and lists", () => {
  const quoted = "assets/1723500000000-abc1234.png";
  const listed = "assets/1723500000001-def5678.webp";
  const indented = "assets/1723500000002-ghi9012.jpg";
  const source = `> [quoted]: ${quoted}\r\n\r\n- [listed]: <${listed}>\r\n\r\n   [indented]: ${indented} "Title"\r\n`;

  assert.deepEqual(referencedAssets(source), [quoted, listed, indented]);
  assert.deepEqual(planUnusedImageCleanup([quoted, listed, indented], source), {
    remove: [],
    removeDirectory: false,
  });
});

test("reference definitions never turn remote URLs or fenced examples into local assets", () => {
  const orphan = "assets/1723500000000-abc1234.png";
  const source = `![remote][remote]

[remote]: https://example.com/${orphan} "${orphan}"
[protocol relative]: <//example.com/${orphan}>
[data]: data:image/png;base64,aW1hZ2U=
[traversal]: ../${orphan}
[nested traversal]: assets/../${orphan.slice("assets/".length)}

\`\`\`markdown
[example]: ${orphan}
\`\`\`
`;

  assert.deepEqual(referencedAssets(source), []);
  assert.deepEqual(planUnusedImageCleanup([orphan], source), {
    remove: [orphan],
    removeDirectory: true,
  });
});

test("sized HTML images round-trip escaped attributes and retain attachment references", async () => {
  const { serializeImageReference, parseHtmlImage } =
    await import("../src/modules/markdown/images/model.ts");
  const original = {
    source: "assets/a & b.png",
    alt: 'A "quote" <diagram>',
    title: "Figure 1",
  };
  const source = serializeImageReference(original, 480);
  const image = parseHtmlImage(source)!;
  assert.equal(image.width, 480);
  assert.equal(image.source, original.source);
  assert.equal(image.alt, original.alt);
  assert.equal(image.title, original.title);
  assert.equal(
    serializeImageReference(image, 240),
    serializeImageReference(original, 240),
  );
  assert.equal(
    parseHtmlImage(serializeImageReference(image))?.width,
    undefined,
  );
  assert.deepEqual(referencedAssets(source), [original.source]);
});

test("mixed Markdown and HTML occurrences have independent ranges and dimensions", () => {
  const source =
    '![one](assets/a.png "Caption")\n<img src="assets/a.png" alt="two" width="240">\n<img src="assets/a.png" width="720">';
  const images = parseMarkdownImages(source);
  assert.equal(images.length, 3);
  assert.equal(images[0].title, "Caption");
  assert.equal(images[1].width, 240);
  assert.equal(images[2].width, 720);
  for (const image of images)
    assert.match(source.slice(image.from, image.to), /assets\/a.png/);
  const next = replaceMarkdownRange(
    source,
    images[1].from,
    images[1].to,
    '<img src="assets/a.png" width="480">',
  );
  assert.deepEqual(
    parseMarkdownImages(next).map((image) => image.width),
    [undefined, 480, 720],
  );
});

test("cleanup protects sized generated assets including single-quoted HTML references", () => {
  const asset = "assets/1723500000000-abc1234.png";
  assert.deepEqual(
    planUnusedImageCleanup(
      [asset],
      `<img width='480' src='${asset}' alt='A &amp; B'>`,
    ),
    { remove: [], removeDirectory: false },
  );
});

test("HTML images do not turn alt text into duplicate attachment references", () => {
  const images = parseMarkdownImages(
    '<img src="assets/a.png" alt="![example](assets/b.png)" width="320">',
  );
  assert.equal(images.length, 1);
  assert.equal(images[0].source, "assets/a.png");
});
