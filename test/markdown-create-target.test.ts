import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarkdownCollectionID } from "../src/modules/markdown/create-target.ts";

test("explicit collection ID takes precedence without reading ZoteroPane", () => {
  assert.equal(
    resolveMarkdownCollectionID(
      {
        getSelectedCollections() {
          throw new Error("selection must not be read");
        },
      },
      44,
    ),
    44,
  );
});

test("Markdown creation keeps using the first selected collection", () => {
  assert.equal(
    resolveMarkdownCollectionID({
      getSelectedCollections: () => [12, 13],
    }),
    12,
  );
});

test("invalid or empty first selections do not create collection membership", () => {
  assert.equal(
    resolveMarkdownCollectionID({ getSelectedCollections: () => [] }),
    undefined,
  );
  assert.equal(
    resolveMarkdownCollectionID({ getSelectedCollections: () => [0, 13] }),
    undefined,
  );
});
