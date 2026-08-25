import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release bump updates package.json", async () => {
  const config = await readFile("zotero-plugin.config.ts", "utf8");
  const files = config.match(/files:\s*\[([^\]]+)\]/s)?.[1] ?? "";

  assert.match(files, /["']package\.json["']/);
});

test("release download uses the configured versioned XPI name", async () => {
  const config = await readFile("zotero-plugin.config.ts", "utf8");

  assert.match(config, /xpiName:\s*`bamboo-v\$\{pkg\.version\}`/);
  assert.match(config, /\{\{xpiName\}\}\.xpi/);
});
