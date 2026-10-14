import assert from "node:assert/strict";
import test from "node:test";
import { cleanupWhiteboardAssets } from "../src/modules/whiteboard/assets.ts";
import { renderWhiteboardMarkdown } from "../packages/whiteboard/src/nodes/markdown.tsx";

(
  globalThis as {
    PathUtils?: {
      join: (...parts: string[]) => string;
      filename: (path: string) => string;
    };
  }
).PathUtils = {
  join: (...parts) => parts.join("/"),
  filename: (path) => path.split(/[\\/]/).pop() || "",
};

test("whiteboard asset cleanup preserves references and continues after one error", async () => {
  const assetsDir = "/library/canvas/assets";
  const children = [
    `${assetsDir}/keep.png`,
    `${assetsDir}/stale.png`,
    `${assetsDir}/broken.png`,
    `${assetsDir}/folder`,
    `${assetsDir}/after-error.png`,
  ];
  const removed: string[] = [];
  const statted: string[] = [];
  const errors: string[] = [];
  await cleanupWhiteboardAssets(
    assetsDir,
    new Set(["keep.png"]),
    {
      getChildren: async () => children,
      stat: async (path) => {
        statted.push(path);
        if (path.endsWith("broken.png")) throw new Error("gone");
        return { type: path.endsWith("folder") ? "directory" : "regular" };
      },
      remove: async (path) => void removed.push(path),
    },
    (name) => errors.push(name),
  );
  assert.deepEqual(removed, [
    `${assetsDir}/stale.png`,
    `${assetsDir}/after-error.png`,
  ]);
  assert.deepEqual(errors, ["broken.png"]);
  assert.equal(statted.includes(`${assetsDir}/keep.png`), false);
  assert.equal(removed.includes(`${assetsDir}/folder`), false);
});

test("whiteboard Markdown rendering is useful but does not emit unsafe links", () => {
  const html = renderWhiteboardMarkdown(
    "# Heading\n\n- one\n- two\n\n[bad](javascript:alert(1)) [ok](https://example.com)",
  );
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /bad/);
  assert.doesNotMatch(html, /(?:href|src)=["'][^"']*javascript:/i);
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed)\b/i);
  assert.match(html, /href="https:\/\/example.com"/);
});
