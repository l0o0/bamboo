import assert from "node:assert/strict";
import test from "node:test";
import { ImageAssetCache } from "../src/modules/markdown/images/asset-cache.ts";
import {
  resolveImageAsset,
  resolveImageAssets,
} from "../src/modules/markdown/images/service.ts";

test("asset cache evicts by retained bytes and refreshes LRU recency", () => {
  const cache = new ImageAssetCache(16, 12, 200);
  cache.set("a", "1", "aaaa");
  cache.set("b", "1", "bbbb");
  assert.equal(cache.byteLength, 16);
  assert.equal(cache.get("a", "1"), "aaaa");
  cache.set("c", "1", "cccc");
  assert.equal(cache.get("b", "1"), undefined);
  assert.equal(cache.get("a", "1"), "aaaa");
  assert.equal(cache.get("c", "1"), "cccc");
  assert.equal(cache.byteLength, 16);
});

test("asset cache rejects large replacements without retaining stale revisions", () => {
  const cache = new ImageAssetCache(24, 8, 2);
  cache.set("a", "1", "aaaa");
  cache.set("b", "1", "bbbb");
  cache.set("a", "2", "too large");
  assert.equal(cache.get("a", "1"), undefined);
  assert.equal(cache.get("a", "2"), undefined);
  assert.equal(cache.byteLength, 8);
  cache.set("b", "2", "bb");
  assert.equal(cache.byteLength, 4);
  assert.equal(cache.get("b", "3"), undefined);
  assert.equal(cache.byteLength, 0);
});

test("asset cache keeps full paths isolated and enforces entry count", () => {
  const cache = new ImageAssetCache(100, 100, 2);
  cache.set("/one/assets/a.png", "1:4", "one");
  cache.set("/two/assets/a.png", "1:4", "two");
  assert.equal(cache.get("/one/assets/a.png", "1:4"), "one");
  assert.equal(cache.get("/two/assets/a.png", "1:4"), "two");
  cache.set("/three/assets/a.png", "1:4", "three");
  assert.equal(cache.size, 2);
  assert.equal(cache.get("/one/assets/a.png", "1:4"), undefined);
});

test("asset resolution checks each attachment path and revision before using cache", async (t) => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(
    ["Zotero", "IOUtils", "PathUtils"].map((key) => [key, globals[key]]),
  );
  t.after(() => Object.assign(globals, previous));
  let revision = 1;
  const reads: string[] = [];
  Object.assign(globals, {
    Zotero: {
      Attachments: {
        getStorageDirectory: (item: { key: string }) => ({
          path: `/cache-test/${item.key}`,
        }),
      },
    },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    IOUtils: {
      exists: async () => true,
      stat: async () => ({ lastModified: revision, size: 1 }),
      read: async (path: string) => {
        reads.push(path);
        return new Uint8Array([path.includes("/one/") ? revision : 9]);
      },
    },
  });
  const item = (key: string) =>
    ({
      key,
      isStoredFileAttachment: () => true,
      attachmentContentType: "text/markdown",
    }) as Zotero.Item;
  const first = await resolveImageAsset(item("one"), "assets/a.png");
  const second = await resolveImageAsset(item("two"), "assets/a.png");
  assert.notEqual(first, second);
  assert.equal(await resolveImageAsset(item("one"), "assets/a.png"), first);
  assert.equal(reads.length, 2);
  revision += 1;
  assert.notEqual(await resolveImageAsset(item("one"), "assets/a.png"), first);
  assert.equal(reads.length, 3);
});

test("batch image resolution bounds parallel file reads while preserving every result", async (t) => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(
    ["Zotero", "IOUtils", "PathUtils"].map((key) => [key, globals[key]]),
  );
  t.after(() => Object.assign(globals, previous));
  let active = 0;
  let peak = 0;
  Object.assign(globals, {
    Zotero: {
      Attachments: { getStorageDirectory: () => ({ path: "/cache-batch" }) },
    },
    PathUtils: { join: (...parts: string[]) => parts.join("/") },
    IOUtils: {
      exists: async () => true,
      stat: async () => ({ lastModified: 1, size: 1 }),
      read: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return new Uint8Array([1]);
      },
    },
  });
  const item = {
    isStoredFileAttachment: () => true,
    attachmentContentType: "text/markdown",
  } as Zotero.Item;
  const markdown = Array.from(
    { length: 13 },
    (_, index) => `![](assets/${index}.png)`,
  ).join("\n");
  const result = await resolveImageAssets(item, markdown);
  assert.equal(Object.keys(result).length, 13);
  assert.equal(peak, 4);
  assert.ok(Object.values(result).every((entry) => entry.dataUrl));
});
