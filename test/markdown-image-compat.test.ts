import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { parseMarkdownImages } from "../src/modules/markdown/images/model.ts";
import {
  applyAssetsToHtml,
  hydratePreviewImages,
  renderMarkdown,
} from "../src/modules/markdown/preview.ts";
import type { ImageAssetMap } from "../src/modules/markdown/editor-protocol.ts";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function dom(context: TestContext) {
  const window = new Window({ url: "https://preview.test/" });
  context.after(() => window.happyDOM.close());
  const html = (source: string) => {
    const host = window.document.createElement("div");
    host.innerHTML = source;
    return host;
  };
  return { html };
}

function assertHydratedAndExported(
  context: TestContext,
  sourceHtml: string,
  assets: ImageAssetMap,
  expected: string,
) {
  const { html } = dom(context);
  const preview = html(sourceHtml);
  hydratePreviewImages(preview as unknown as HTMLElement, assets);
  assert.equal(preview.querySelector("img")?.getAttribute("src"), expected);
  assert.equal(preview.querySelector(".zotero-markdown-image-missing"), null);
  const exported = html(applyAssetsToHtml(sourceHtml, assets));
  assert.equal(exported.querySelector("img")?.getAttribute("src"), expected);
  return { preview, exported };
}

test("reference-style images resolve full, collapsed, shortcut and escaped labels across the document", () => {
  const occurrences = [
    "![Visible figure][FULL label]",
    "![Collapsed LABEL][]",
    "![Shortcut]",
    "![Escaped figure][A\\]B]",
  ];
  const source = [
    "Introduction.",
    "",
    ...occurrences,
    "",
    '[full LABEL]: assets/full.png "Full title"',
    "[collapsed label]:",
    "  <assets/collapsed image.webp>",
    "  'Collapsed title'",
    "[SHORTCUT]: assets/shortcut.jpg",
    "[a\\]b]: assets/escaped.png",
  ].join("\n");
  const images = parseMarkdownImages(source);
  assert.equal(images.length, 4);
  assert.deepEqual(
    images.map(({ source, alt, title }) => ({ source, alt, title })),
    [
      {
        source: "assets/full.png",
        alt: "Visible figure",
        title: "Full title",
      },
      {
        source: "assets/collapsed image.webp",
        alt: "Collapsed LABEL",
        title: "Collapsed title",
      },
      { source: "assets/shortcut.jpg", alt: "Shortcut", title: undefined },
      { source: "assets/escaped.png", alt: "Escaped figure", title: undefined },
    ],
  );
  assert.deepEqual(
    images.map(({ from, to }) => source.slice(from, to)),
    occurrences,
    "Image ranges cover the occurrences, not the distant definitions",
  );
});

test("reference definitions use the first matching label and leave undefined references as text", () => {
  const source =
    "![One][duplicate] ![Unknown][missing]\n\n" +
    "[DUPLICATE]: assets/first.png\n[duplicate]: assets/second.png";
  const images = parseMarkdownImages(source);
  assert.equal(images.length, 1);
  assert.equal(images[0].source, "assets/first.png");
  assert.equal(source.slice(images[0].from, images[0].to), "![One][duplicate]");
});

test("local Wiki image embeds normalize sibling and assets paths and preserve per-occurrence width", () => {
  const source = "Before ![[figure.png]] and ![[assets/figure.png|320]] after.";
  const images = parseMarkdownImages(source);
  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map(({ source, width }) => ({ source, width })),
    [
      { source: "assets/figure.png", width: undefined },
      { source: "assets/figure.png", width: 320 },
    ],
  );
  assert.deepEqual(
    images.map(({ from, to }) => source.slice(from, to)),
    ["![[figure.png]]", "![[assets/figure.png|320]]"],
  );
});

test("reference-style pictures render and hydrate in reading mode and export", (context) => {
  const source =
    '![Visible][figure]\n\n[FIGURE]: <assets/my image.png> "Figure title"';
  const { preview, exported } = assertHydratedAndExported(
    context,
    renderMarkdown(source),
    { "assets/my image.png": { dataUrl: PNG } },
    PNG,
  );
  for (const host of [preview, exported]) {
    const image = host.querySelector("img")!;
    assert.equal(image.getAttribute("alt"), "Visible");
    assert.equal(image.getAttribute("title"), "Figure title");
  }
});

test("Wiki embeds render two actual pictures and retain the sized occurrence in reading mode and export", (context) => {
  const source = "![[figure.png]]\n\n![[assets/figure.png|320]]";
  const { html } = dom(context);
  const rendered = renderMarkdown(source);
  const assets = { "assets/figure.png": { dataUrl: PNG } };
  const preview = html(rendered);
  hydratePreviewImages(preview as unknown as HTMLElement, assets);
  const exported = html(applyAssetsToHtml(rendered, assets));
  for (const host of [preview, exported]) {
    const images = [...host.querySelectorAll("img")];
    assert.equal(images.length, 2);
    assert.ok(images.every((image) => image.getAttribute("src") === PNG));
    assert.equal(images[0].getAttribute("width"), null);
    assert.equal(images[1].getAttribute("width"), "320");
    assert.doesNotMatch(host.textContent, /!\[\[/);
  }
});

test("reading and exported images match spaces, Unicode, HTML entities and URI-encoded filenames", async (context) => {
  const cases = [
    {
      name: "spaces normalized by the Markdown renderer",
      html: renderMarkdown("![Space](<assets/my image.png>)"),
      key: "assets/my image.png",
    },
    {
      name: "Unicode normalized by the Markdown renderer",
      html: renderMarkdown("![中文](<assets/研究 图.png>)"),
      key: "assets/研究 图.png",
    },
    {
      name: "explicit percent-encoded reference destination",
      html: renderMarkdown(
        "![Figure][img]\n\n[img]: assets/1723500000000%2Dabc1234.png",
      ),
      key: "assets/1723500000000-abc1234.png",
    },
    {
      name: "HTML-escaped ampersand in an asset path",
      html: '<img src="assets/a &amp; b.png" alt="Figure">',
      key: "assets/a & b.png",
    },
  ];
  for (const example of cases) {
    await context.test(example.name, (child) => {
      assertHydratedAndExported(
        child,
        example.html,
        { [example.key]: { dataUrl: PNG } },
        PNG,
      );
    });
  }
});

test("literal percent filenames win over a decoded spelling when both assets exist", (context) => {
  assertHydratedAndExported(
    context,
    '<img src="assets/chart%20one.png" alt="Figure">',
    {
      "assets/chart%20one.png": { dataUrl: PNG },
      "assets/chart one.png": { dataUrl: GIF },
    },
    PNG,
  );
});

test("an unavailable literal spelling falls back to the existing decoded asset", (context) => {
  assertHydratedAndExported(
    context,
    '<img src="assets/chart%20one.png" alt="Figure">',
    {
      "assets/chart%20one.png": { error: "Synthetic literal file absent" },
      "assets/chart one.png": { dataUrl: GIF },
    },
    GIF,
  );
});

test("URI matching decodes once and keeps malformed literal percent names usable", async (context) => {
  await context.test(
    "one decoding step does not collapse two different filenames",
    (child) => {
      assertHydratedAndExported(
        child,
        '<img src="assets/chart%2520one.png">',
        {
          "assets/chart%20one.png": { dataUrl: PNG },
          "assets/chart one.png": { dataUrl: GIF },
        },
        PNG,
      );
    },
  );
  await context.test(
    "a literal non-URI percent sequence is still a valid local filename",
    (child) => {
      assertHydratedAndExported(
        child,
        '<img src="assets/figure%ZZ.png">',
        { "assets/figure%ZZ.png": { dataUrl: PNG } },
        PNG,
      );
    },
  );
});

test("asset matching never promotes decoded traversal or remote paths into local image data", async (context) => {
  const cases = [
    {
      name: "encoded parent directory",
      src: "assets/%2E%2E%2Fsecret.png",
      decodedKey: "assets/../secret.png",
    },
    {
      name: "encoded slash cannot be stripped to a basename",
      src: "assets/%2Fsecret.png",
      decodedKey: "assets/secret.png",
    },
    {
      name: "encoded backslash parent directory",
      src: "assets/%5C..%5Csecret.png",
      decodedKey: "assets/../secret.png",
    },
    {
      name: "remote URL containing a local-looking path",
      src: "https://remote.test/assets/secret.png",
      decodedKey: "assets/secret.png",
    },
    {
      name: "encoded remote URL",
      src: "https%3A%2F%2Fremote.test%2Fassets%2Fsecret.png",
      decodedKey: "assets/secret.png",
    },
    {
      name: "protocol-relative remote URL",
      src: "//remote.test/assets/secret.png",
      decodedKey: "assets/secret.png",
    },
  ];
  for (const example of cases) {
    await context.test(example.name, (child) => {
      const { html } = dom(child);
      const sourceHtml = `<img src="${example.src}" alt="Untrusted">`;
      const assets = { [example.decodedKey]: { dataUrl: PNG } };
      const preview = html(sourceHtml);
      hydratePreviewImages(preview as unknown as HTMLElement, assets);
      assert.ok(
        [...preview.querySelectorAll("img")].every(
          (image) => image.getAttribute("src") !== PNG,
        ),
      );
      const exported = html(applyAssetsToHtml(sourceHtml, assets));
      assert.ok(
        [...exported.querySelectorAll("img")].every(
          (image) => image.getAttribute("src") !== PNG,
        ),
      );
    });
  }
});

test("image-like code and remote or traversing Wiki syntax stay unrendered", (context) => {
  const source = [
    "`![[figure.png]]`",
    "",
    "```md",
    "![[assets/figure.png|320]]",
    "![Code][img]",
    "```",
    "",
    "![[https://remote.test/figure.png]]",
    "![[../assets/figure.png]]",
    "![[assets/../figure.png]]",
    "",
    "[img]: assets/figure.png",
  ].join("\n");
  const { html } = dom(context);
  const rendered = html(renderMarkdown(source));
  assert.equal(rendered.querySelectorAll("img").length, 0);
  assert.match(rendered.querySelector("code")?.textContent || "", /!\[\[/);
});

test("ordinary Markdown and sized HTML images retain their source ranges and metadata", (context) => {
  const markdown = '![Plain](assets/plain.png "Plain title")';
  const sized =
    '<img src="assets/sized.png" alt="A &amp; B" title="Figure &quot;1&quot;" width="480">';
  const source = `${markdown}\n\n${sized}`;
  const images = parseMarkdownImages(source);
  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map(({ from, to }) => source.slice(from, to)),
    [markdown, sized],
  );
  assert.equal(images[0].source, "assets/plain.png");
  assert.equal(images[0].title, "Plain title");
  assert.equal(images[0].width, undefined);
  assert.equal(images[1].source, "assets/sized.png");
  assert.equal(images[1].alt, "A & B");
  assert.equal(images[1].title, 'Figure "1"');
  assert.equal(images[1].width, 480);

  const { html } = dom(context);
  const assets = {
    "assets/plain.png": { dataUrl: PNG },
    "assets/sized.png": { dataUrl: GIF },
  };
  const rendered = renderMarkdown(source);
  const preview = html(rendered);
  hydratePreviewImages(preview as unknown as HTMLElement, assets);
  const exported = html(applyAssetsToHtml(rendered, assets));
  for (const host of [preview, exported]) {
    const pictures = [...host.querySelectorAll("img")];
    assert.equal(pictures.length, 2);
    assert.equal(pictures[0].getAttribute("src"), PNG);
    assert.equal(pictures[0].getAttribute("title"), "Plain title");
    assert.equal(pictures[0].getAttribute("width"), null);
    assert.equal(pictures[1].getAttribute("src"), GIF);
    assert.equal(pictures[1].getAttribute("width"), "480");
    assert.equal(pictures[1].getAttribute("alt"), "A & B");
    assert.equal(pictures[1].getAttribute("title"), 'Figure "1"');
  }
});
