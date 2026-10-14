import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MarkdownParser } from "@lezer/markdown";

type MarkdownModule = typeof import("@lezer/markdown");
type Tree = ReturnType<MarkdownParser["parse"]>;
type Fragments = NonNullable<Parameters<MarkdownParser["parse"]>[1]>;
type ChangedRange = {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
};
type FragmentAPI = {
  addTree(tree: Tree, fragments?: Fragments): Fragments;
  applyChanges(
    fragments: Fragments,
    changes: readonly ChangedRange[],
    minGap?: number,
  ): Fragments;
};
type Modules = {
  name: string;
  installed: MarkdownModule;
  original: MarkdownModule;
  fragments: FragmentAPI;
};

/**
 * Recover the published source by reversing only the installed package's
 * checked-in patch. Every hunk must match the installed source exactly, so an
 * unapplied or stale patch fails instead of silently comparing two originals.
 */
function reversePackagePatch(source: string, patch: string, filename: string) {
  const sourceLines = source.split("\n");
  const lines = patch.split("\n");
  const restored: string[] = [];
  let selected = false;
  let position = 0;
  let hunkCount = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("diff --git ")) selected = false;
    if (line.startsWith("+++ ")) {
      selected = line === `+++ b/${filename}`;
      continue;
    }
    if (!selected || !line.startsWith("@@ ")) continue;
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    assert.ok(header, `valid patch hunk for ${filename}`);
    const from = Number(header[3]) - 1;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (!/^[ +-]/.test(next) || next.startsWith("--- ")) break;
      index++;
      if (next[0] !== "+") oldLines.push(next.slice(1));
      if (next[0] !== "-") newLines.push(next.slice(1));
    }
    assert.equal(oldLines.length, Number(header[2] ?? 1));
    assert.equal(newLines.length, Number(header[4] ?? 1));
    assert.ok(from >= position, `ordered patch hunks for ${filename}`);
    assert.deepEqual(
      sourceLines.slice(from, from + newLines.length),
      newLines,
      `installed ${filename} contains its configured patch`,
    );
    restored.push(...sourceLines.slice(position, from), ...oldLines);
    position = from + newLines.length;
    hunkCount++;
  }
  assert.ok(hunkCount > 0, `patch includes ${filename}`);
  restored.push(...sourceLines.slice(position));
  return restored.join("\n");
}

async function loadModules(): Promise<Modules[]> {
  const require = createRequire(import.meta.url);
  const installedCJS = require.resolve("@lezer/markdown");
  const packageDirectory = dirname(dirname(installedCJS));
  const dependencyDirectory = dirname(dirname(packageDirectory));
  const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
  const metadata = JSON.parse(
    readFileSync(join(projectDirectory, "package.json"), "utf8"),
  ) as {
    pnpm?: { patchedDependencies?: Record<string, string> };
  };
  const patchPath =
    metadata.pnpm?.patchedDependencies?.["@lezer/markdown@1.7.2"];
  assert.ok(patchPath, "the link-scanning patch is registered with pnpm");
  const patch = readFileSync(join(projectDirectory, patchPath), "utf8");
  const directory = mkdtempSync(join(tmpdir(), "scholar-lezer-original-"));
  after(() => rmSync(directory, { recursive: true, force: true }));
  // Both copies resolve the identical dependency modules. This also keeps
  // Lezer's instanceof checks valid when fragments are supplied to either one.
  symlinkSync(dependencyDirectory, join(directory, "node_modules"), "dir");
  for (const [installedFile, originalFile] of [
    ["dist/index.js", "original.mjs"],
    ["dist/index.cjs", "original.cjs"],
  ]) {
    const installed = readFileSync(
      join(packageDirectory, installedFile),
      "utf8",
    );
    writeFileSync(
      join(directory, originalFile),
      reversePackagePatch(installed, patch, installedFile),
    );
  }
  const commonCJS = createRequire(installedCJS).resolve("@lezer/common");
  return [
    {
      name: "import",
      installed: await import("@lezer/markdown"),
      original: (await import(
        pathToFileURL(join(directory, "original.mjs")).href
      )) as MarkdownModule,
      fragments: (
        (await import(
          pathToFileURL(join(dirname(commonCJS), "index.js")).href
        )) as { TreeFragment: FragmentAPI }
      ).TreeFragment,
    },
    {
      name: "require",
      installed: require(installedCJS) as MarkdownModule,
      original: require(join(directory, "original.cjs")) as MarkdownModule,
      fragments: (require(commonCJS) as { TreeFragment: FragmentAPI })
        .TreeFragment,
    },
  ];
}

const modules = await loadModules();

function snapshot(tree: Tree) {
  const cursor = tree.cursor();
  const nodes: (string | number)[][] = [];
  let depth = 0;
  for (;;) {
    nodes.push([depth, cursor.name, cursor.from, cursor.to]);
    if (cursor.firstChild()) {
      depth++;
      continue;
    }
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) return nodes;
      depth--;
    }
  }
}

function configurations(pair: Modules) {
  return [
    {
      name: "CommonMark",
      installed: pair.installed.parser,
      original: pair.original.parser,
    },
    {
      name: "GFM",
      installed: pair.installed.parser.configure(pair.installed.GFM),
      original: pair.original.parser.configure(pair.original.GFM),
    },
  ];
}

const cases = [
  "[a](one) [b](two) [c](three)",
  "[outer [inner](inside)](outside)",
  "[outer [inner](inside) tail][reference]",
  "[outer [unclosed [inner](inside)] tail](outside)",
  "[a](one) [unclosed [b](two) [c](three)](four)",
  "[[[a](one)](two)](three)",
  "[a](one) ] ] [b](two) [c](three)",
  "[ ] [a](one) [] [b](two) ![] ![](image)",
  "[a] [b][missing] [c][] [d](broken [e](valid)",
  "[a](one) [unfinished ![image](image) [b](two)",
  "![outer [inner](inside)](image)",
  "[outer ![inner](image)](link)",
  "![outer ![inner](inside)](outside)",
  "![outer [a](one) [b](two)](image) [c](three)",
  "![image [inner](x)](img) [newOuter [nested](y)](outer)",
  "![image [inner](x)](img) ![next [a](y)](img) [outer [b](z)](u)",
  "![image [a](x) [b](y)](img) **[outer [nested](z)](u)**",
  "![outer [a](one) ![inner [b](two)](image)](outer) [c](three)",
  "[prefix](one) ![outer [a](two) [b](three)](image) [tail](four)",
  "![prefix](one) [unclosed ![a [b](two)](image)](three)",
  "[**bold** and _emphasis_](url) [a **b [c](u) d**](v)",
  "*[a](one) ![b](two)* **[c](three)** [*d*](four)",
  "[a **b** ![c](image) `d[e]`](url)",
  "[a\\]b](url) \\[not](url) !\\[not](image) [a](one)",
  "[a\\[b\\]c](url) [d](path\\(part\\))",
  "[`[literal](url)` and ``![code]``](actual)",
  "`[a](one)` [b](two) \\\\ [c](three)",
  '[a](<a b>) [b](a(b(c))) [c](a\\)b "title")',
  "[a](url 'title') [b](url (title)) [c](url \"[title]\")",
  '[a](url\n"title") [b\ncontinued](other)',
  "[a](one) [b\n\nseparate](two)",
  '[a][Ref] ![b][Ref] [Ref][] [Ref]\n\n[Ref]: /url "title"',
  "[a][r] [a][R] [r][] [r]\n\n[r]:\n  <url>\n  'title'",
  "[a][r] [b][r] [r]: /not-a-definition\n\n[r]: /first\n[r]: /second",
  '[a][r] ![b][r]\n\n[r]: /url\n  "multiline\n  title"',
  "> [a](one) ![b](image)\n> [c](two)\n\n- [d](three)\n- [e](four)",
  "# [heading](url)\n\n    [code](url)\n\n```md\n[a](one)\n```\n\n[b](two)",
  "[a](one) <https://example.test/a> <a href='x'>[b](two)</a>",
  "<!-- [a](one) -->\n\n[b](two) <span>[c](three)</span>",
  "[a](one) &lbrack; [b](two) &#91; [c](three)",
  "~~[a](one) ![b](image)~~ [c ~~d [e](two)~~](three)",
  "[a](one) ~~![outer [b](two)](image)~~ [c](three)",
  "| [a](one) | ![b](image) |\n| --- | --- |\n| [c](two) | [d](three) |",
  "- [x] [a](one)\n- [ ] ![outer [b](two)](image)\n- [x] [c](three)",
  "[a](one) www.example.test [b](two) https://example.test/a_(b)",
  "[https://example.test [a](one)](two) ![www.example.test](image)",
  "[a](one) [b](two)  \n[c](three)\\\n[d](four)",
  "[文献](zotero://select/library/items/ABCD1234) ![图](assets/a%20b.png)",
];

test("link parsing preserves published CommonMark and GFM trees in both module formats", () => {
  const documents = [
    ...cases,
    cases.join("\n\n"),
    cases.filter((value) => !value.includes("\n")).join(" "),
    Array.from({ length: 12 }).reduce<string>(
      (content, _, index) => `![level ${index} ${content}](image-${index})`,
      "[innermost](target)",
    ) + " [outer [nested](target)](url)",
    Array.from(
      { length: 100 },
      (_, index) => `[link ${index}](url-${index})`,
    ).join(" "),
  ];
  for (const pair of modules) {
    assert.equal(
      pair.installed.parser.parse("a").constructor,
      pair.original.parser.parse("a").constructor,
      `${pair.name} oracle shares the installed Lezer tree class`,
    );
    for (const config of configurations(pair)) {
      for (const [index, document] of documents.entries()) {
        assert.deepEqual(
          snapshot(config.installed.parse(document)),
          snapshot(config.original.parse(document)),
          `${pair.name} ${config.name}, fixture ${index}: ${document}`,
        );
      }
    }
  }
});

function random(seed: number) {
  let state = seed >>> 0;
  return (maximum: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % maximum;
  };
}

const tokens = [
  "text",
  "中文",
  "🙂",
  " ",
  "\n",
  "\n\n",
  "[",
  "]",
  "![",
  "](url)",
  "][r]",
  "][]",
  '](url "title")',
  "[a](u)",
  "![a](image)",
  "[r]",
  "[a][r]",
  "\\[",
  "\\]",
  "`",
  "``",
  "`[code](url)`",
  "*",
  "**",
  "_",
  "~~",
  "<a>",
  "</a>",
  "<!--",
  "-->",
  "<https://example.test>",
  "https://example.test/a",
  "\\\n",
  "  \n",
  "(a(b))",
  '\n[r]: /url "title"\n',
  "\n- [x] ",
  "\n> ",
  "\n```\n",
  " | ",
];

test("seeded link, image, delimiter, and reference mixtures match the published parser", () => {
  const next = random(0x1e2e7);
  const documents = Array.from({ length: 400 }, () => {
    const count = 10 + next(70);
    return Array.from(
      { length: count },
      () => tokens[next(tokens.length)],
    ).join("");
  });
  for (const pair of modules) {
    for (const config of configurations(pair)) {
      for (const [index, document] of documents.entries()) {
        assert.deepEqual(
          snapshot(config.installed.parse(document)),
          snapshot(config.original.parse(document)),
          `${pair.name} ${config.name}, seed 0x1e2e7, case ${index}: ${document}`,
        );
      }
    }
  }
});

type Edit = { from: number; to: number; insert: string };

function applyEdits(document: string, edits: readonly Edit[]) {
  const changes: ChangedRange[] = [];
  let next = "";
  let position = 0;
  let delta = 0;
  for (const edit of edits) {
    next += document.slice(position, edit.from) + edit.insert;
    changes.push({
      fromA: edit.from,
      toA: edit.to,
      fromB: edit.from + delta,
      toB: edit.from + delta + edit.insert.length,
    });
    delta += edit.insert.length - (edit.to - edit.from);
    position = edit.to;
  }
  return { document: next + document.slice(position), changes };
}

test("TreeFragment updates retain published link trees and equal fresh parsing", () => {
  const initial = Array.from(
    { length: 24 },
    (_, index) =>
      `Paragraph ${index}: [link](url-${index}) ![outer [inner](target)](image)\n\n`,
  ).join("");
  for (const pair of modules) {
    for (const config of configurations(pair)) {
      const next = random(0x5eed1e);
      let document = initial;
      let installedTree = config.installed.parse(document);
      let originalTree = config.original.parse(document);
      let installedFragments = pair.fragments.addTree(installedTree);
      let originalFragments = pair.fragments.addTree(originalTree);
      for (let index = 0; index < 100; index++) {
        const from = next(document.length + 1);
        const to = Math.min(document.length, from + next(13));
        const edits: Edit[] = [
          { from, to, insert: tokens[next(tokens.length)] },
        ];
        if (index % 3 === 0 && to + 1 < document.length) {
          const second = to + 1 + next(document.length - to);
          edits.push({
            from: second,
            to: Math.min(document.length, second + next(5)),
            insert: tokens[next(tokens.length)],
          });
        }
        const update = applyEdits(document, edits);
        document = update.document;
        installedFragments = pair.fragments.applyChanges(
          installedFragments,
          update.changes,
          0,
        );
        originalFragments = pair.fragments.applyChanges(
          originalFragments,
          update.changes,
          0,
        );
        installedTree = config.installed.parse(document, installedFragments);
        originalTree = config.original.parse(document, originalFragments);
        const expected = snapshot(config.original.parse(document));
        const label = `${pair.name} ${config.name}, seed 0x5eed1e, edit ${index}`;
        assert.deepEqual(snapshot(originalTree), expected, `${label}: oracle`);
        assert.deepEqual(
          snapshot(config.installed.parse(document)),
          expected,
          `${label}: installed fresh parse`,
        );
        assert.deepEqual(
          snapshot(installedTree),
          expected,
          `${label}: installed incremental parse`,
        );
        installedFragments = pair.fragments.addTree(
          installedTree,
          installedFragments,
        );
        originalFragments = pair.fragments.addTree(
          originalTree,
          originalFragments,
        );
      }
    }
  }
});

test("completed links invalidate only new parts instead of rescanning paragraph history", async (t) => {
  const require = createRequire(import.meta.url);
  const packageDirectory = dirname(dirname(require.resolve("@lezer/markdown")));
  const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
  const metadata = JSON.parse(
    readFileSync(join(projectDirectory, "package.json"), "utf8"),
  ) as { pnpm: { patchedDependencies: Record<string, string> } };
  const patch = readFileSync(
    join(
      projectDirectory,
      metadata.pnpm.patchedDependencies["@lezer/markdown@1.7.2"],
    ),
    "utf8",
  );
  const directory = mkdtempSync(join(tmpdir(), "scholar-lezer-link-count-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  symlinkSync(
    dirname(dirname(packageDirectory)),
    join(directory, "node_modules"),
    "dir",
  );
  type CountedModule = MarkdownModule & {
    resetLinkVisits(): void;
    readLinkVisits(): number;
  };
  for (const extension of ["js", "cjs"]) {
    const filename = `dist/index.${extension}`;
    const installed = readFileSync(join(packageDirectory, filename), "utf8");
    const original = reversePackagePatch(installed, patch, filename);
    const counted: CountedModule[] = [];
    for (const [label, source] of [
      ["original", original],
      ["installed", installed],
    ]) {
      // Count the actual invalidation loop without replacing any parser logic.
      const anchor = "let p = cx.parts[j];";
      assert.equal(
        source.split(anchor).length,
        2,
        "one counter insertion site",
      );
      const exports = extension === "js" ? "export const " : "exports.";
      const instrumented =
        source.replace(anchor, `linkInvalidationVisits++; ${anchor}`) +
        `\nlet linkInvalidationVisits = 0;\n` +
        `${exports}resetLinkVisits = () => { linkInvalidationVisits = 0; };\n` +
        `${exports}readLinkVisits = () => linkInvalidationVisits;\n`;
      const path = join(
        directory,
        `${label}.${extension === "js" ? "mjs" : "cjs"}`,
      );
      writeFileSync(path, instrumented);
      counted.push(
        extension === "js"
          ? ((await import(pathToFileURL(path).href)) as CountedModule)
          : (require(path) as CountedModule),
      );
    }
    const [baseline, optimized] = counted;
    const visits: { links: number; original: number; installed: number }[] = [];
    for (const links of [256, 512, 1024]) {
      const document = Array.from(
        { length: links },
        (_, index) => `**text** [link ${index}](url-${index})`,
      ).join(" ");
      baseline.resetLinkVisits();
      optimized.resetLinkVisits();
      assert.deepEqual(
        snapshot(optimized.parser.parse(document)),
        snapshot(baseline.parser.parse(document)),
        `${extension}: ${links} sequential links retain the published tree`,
      );
      const originalVisits = baseline.readLinkVisits();
      const installedVisits = optimized.readLinkVisits();
      assert.ok(originalVisits >= links * links, "original scan is quadratic");
      assert.ok(installedVisits > 0, "the optimized loop is instrumented");
      assert.ok(
        installedVisits <= 4 * links,
        "optimized scan has a linear bound",
      );
      const previous = visits.at(-1);
      if (previous) {
        assert.ok(
          originalVisits > previous.original * 3.9,
          "doubling links approximately quadruples original history visits",
        );
        assert.ok(
          installedVisits <= previous.installed * 2.05,
          "doubling links at most doubles optimized visits",
        );
      }
      visits.push({
        links,
        original: originalVisits,
        installed: installedVisits,
      });
    }
    t.diagnostic(`${extension} invalidation visits: ${JSON.stringify(visits)}`);
  }
});
