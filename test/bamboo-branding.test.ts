import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("uses Bamboo as the sole plugin identity", async () => {
  const pkg = JSON.parse(await read("package.json"));

  assert.equal(pkg.name, "bamboo");
  assert.equal(pkg.config.addonName, "Bamboo 竹子");
  assert.equal(pkg.config.addonID, "bamboo@l0o0.github.io");
  assert.equal(pkg.config.addonRef, "bamboo");
  assert.equal(pkg.config.addonInstance, "Bamboo");
  assert.equal(pkg.config.prefsPrefix, "extensions.zotero.bamboo");
  assert.equal(pkg.repository.url, "git+https://github.com/l0o0/bamboo.git");
  assert.equal(pkg.bugs.url, "https://github.com/l0o0/bamboo/issues");
  assert.equal(pkg.homepage, "https://github.com/l0o0/bamboo#readme");
});

test("does not register or document the legacy runtime namespace", async () => {
  const sources = await Promise.all([
    read("src/index.ts"),
    read("src/hooks.ts"),
    read("src/utils/locale.ts"),
    read("src/modules/markdown/api.ts"),
  ]);

  assert.doesNotMatch(sources.join("\n"), /ZoteroMarkdown/);
});

test("uses a versioned Bamboo XPI name in build and CI", async () => {
  const scaffold = await read("zotero-plugin.config.ts");
  const [ci, release] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/release.yml"),
  ]);

  assert.match(scaffold, /xpiName:\s*`bamboo-v\$\{pkg\.version\}`/);
  for (const workflow of [ci, release]) {
    assert.match(workflow, /id:\s*package/);
    assert.match(
      workflow,
      /name:\s*bamboo-v\$\{\{ steps\.package\.outputs\.version \}\}\.xpi/,
    );
    assert.match(
      workflow,
      /\.scaffold\/build\/bamboo-v\$\{\{ steps\.package\.outputs\.version \}\}\.xpi/,
    );
    assert.doesNotMatch(workflow, /zotero-markdown-xpi/);
    assert.doesNotMatch(workflow, /name:\s*build-result/);
  }
});

test("documents Bamboo repository and public API", async () => {
  const readmes = await Promise.all([
    read("README.md"),
    read("doc/README-zhCN.md"),
  ]);
  const combined = readmes.join("\n");

  assert.match(combined, /github\.com\/l0o0\/bamboo\/releases/);
  assert.match(combined, /Zotero\.Bamboo\.api\.markdown/);
  assert.match(combined, /Zotero\.Bamboo\.api\.version/);
  assert.doesNotMatch(combined, /github\.com\/l0o0\/zotero-markdown/);
  assert.doesNotMatch(combined, /Zotero\.ZoteroMarkdown/);
});

test("current architecture docs use the Bamboo product namespace", async () => {
  const docs = await Promise.all([
    read("docs/architecture.md"),
    read("docs/editor/codemirror-iframe-plan.md"),
  ]);
  const combined = docs.join("\n");

  assert.match(combined, /Bamboo/);
  assert.doesNotMatch(combined, /chrome:\/\/zoteromarkdown/);
  assert.doesNotMatch(combined, /content\/scripts\/zoteromarkdown\.js/);
});
