import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import {
  buildNoteExport,
  exportNoteLibrary,
  type NoteExportPlan,
} from "../src/modules/markdown/export-notes.ts";
import {
  portableNoteFilename,
  type NoteDocument,
} from "../src/modules/markdown/note-links.ts";
import { clearNoteLibraries } from "../src/modules/markdown/note-library.ts";

function note(
  key: string,
  filename: string,
  content: string,
  extra: Partial<NoteDocument> = {},
): NoteDocument {
  return {
    libraryID: 1,
    key,
    filename,
    title: filename.replace(/\.md$/i, ""),
    content,
    ...extra,
  };
}

function file(plan: NoteExportPlan, noteValue: NoteDocument): string {
  return (
    plan.files.find((entry) => entry.path === portableNoteFilename(noteValue))
      ?.content ?? ""
  );
}

test("buildNoteExport rewrites portable and legacy note links by source range", () => {
  const first = note(
    "AAAAAAAA",
    "zmd-First.md",
    "---\r\ntitle: First\r\n---\r\n[[Second--BBBBBBBB.md#Results|results]]\r\n[old](zotero://select/library/items/BBBBBBBB)\r\n`[[Second--BBBBBBBB.md]]`\r\n[remote](https://example.com/read)\r\n[[Missing]]\r\n",
  );
  const second = note("BBBBBBBB", "zmd-Second.md", "# Results\r\n\r\nBody\r\n");

  const plan = buildNoteExport([first, second], { format: "wiki" });
  const output = file(plan, first);
  const target = portableNoteFilename(second).replace(/\.md$/i, "");

  assert.match(output, new RegExp(`\\[\\[${target}#Results\\|results\\]\\]`));
  assert.match(output, new RegExp(`\\[\\[${target}\\|old\\]\\]`));
  assert.match(output, /`\[\[Second--BBBBBBBB\.md\]\]`/);
  assert.match(output, /\[remote\]\(https:\/\/example\.com\/read\)/);
  assert.match(output, /title: First\r\n---\r\n/);
  assert.ok(plan.warnings.some((message) => message.includes("Missing")));

  const markdown = file(
    buildNoteExport([first, second], { format: "markdown" }),
    first,
  );
  assert.match(markdown, /\[results\]\(Second--BBBBBBBB\.md#Results\)/);
  assert.match(markdown, /\[old\]\(Second--BBBBBBBB\.md\)/);
});

test("buildNoteExport isolates local images per note and preserves remote images", () => {
  const first = note(
    "AAAAAAAA",
    "First.md",
    "![one](assets/figure.png) ![[Pasted image.png]] ![remote](https://example.com/a.png)\r\n\r\n> ```md\r\n> ![quote](assets/quoted.png)\r\n> ```\r\n\r\n- ```md\n  ![list](assets/listed.png)\n  ```\n\r\n`inline\n![inline](assets/inline.png)`\r\n",
  );
  const second = note("BBBBBBBB", "Second.md", "![two](assets/figure.png)");

  const plan = buildNoteExport([first, second]);
  const firstOutput = file(plan, first);
  const secondOutput = file(plan, second);

  assert.match(firstOutput, /assets\/AAAAAAAA\/figure\.png/);
  assert.match(firstOutput, /assets\/AAAAAAAA\/Pasted image\.png/);
  assert.match(firstOutput, /https:\/\/example\.com\/a\.png/);
  assert.match(firstOutput, /!\[quote\]\(assets\/quoted\.png\)/);
  assert.match(firstOutput, /!\[list\]\(assets\/listed\.png\)/);
  assert.match(firstOutput, /!\[inline\]\(assets\/inline\.png\)/);
  assert.match(secondOutput, /assets\/BBBBBBBB\/figure\.png/);
  assert.deepEqual(
    plan.assets.map(({ key, reference, path }) => ({ key, reference, path })),
    [
      {
        key: "AAAAAAAA",
        reference: "assets/figure.png",
        path: "assets/AAAAAAAA/figure.png",
      },
      {
        key: "AAAAAAAA",
        reference: "assets/Pasted image.png",
        path: "assets/AAAAAAAA/Pasted image.png",
      },
      {
        key: "BBBBBBBB",
        reference: "assets/figure.png",
        path: "assets/BBBBBBBB/figure.png",
      },
    ],
  );

  const unsafeNote = note(
    "CCCCCCCC",
    "Unsafe.md",
    "![secret](/private/secret.png)",
  );
  const unsafe = buildNoteExport([unsafeNote]);
  assert.match(file(unsafe, unsafeNote), /private\/secret\.png/);
  assert.equal(unsafe.assets.length, 0);
  assert.ok(
    unsafe.warnings.some((message) => /unsafe reference/.test(message)),
  );
});

test("buildNoteExport reports unreadable notes and does not create empty files", () => {
  const broken = note("AAAAAAAA", "Broken.md", "", {
    readError: "permission denied",
  });
  const source = note("BBBBBBBB", "Source.md", "[[Broken--AAAAAAAA]]\n");
  const plan = buildNoteExport([broken, source]);

  assert.equal(plan.files.length, 1);
  assert.match(file(plan, source), /\[\[Broken--AAAAAAAA\]\]/);
  assert.deepEqual(plan.assets, []);
  assert.ok(plan.warnings.some((message) => /Broken\.md/.test(message)));
  assert.ok(plan.warnings.some((message) => /permission denied/.test(message)));
  assert.ok(plan.warnings.some((message) => /Broken--AAAAAAAA/.test(message)));
});

test("export preserves image origins and serializes Wiki and HTML destinations safely", () => {
  const source = note(
    "AAAAAAAA",
    "First.md",
    [
      "![sibling](figure.png)",
      "![[assets/figure.png]] ![[Pasted image.png|320]]",
      '<img src="assets/a&quot;b.png" width="400">',
      '<img src="assets/a&amp;copy;.png">',
      "![encoded](assets/space%20name.png)",
      "\\![[assets/escaped.png]]",
      "![[Another note]]",
    ].join("\n"),
  );
  const plan = buildNoteExport([source], { format: "markdown" });
  const output = file(plan, source);
  assert.match(
    output,
    /!\[sibling\]\(assets\/AAAAAAAA\/linked\/1\/figure\.png\)/,
  );
  assert.match(output, /!\[\]\(assets\/AAAAAAAA\/figure\.png\)/);
  assert.match(
    output,
    /<img src="assets\/AAAAAAAA\/Pasted%20image\.png" width="320">/,
  );
  assert.match(output, /src="assets\/AAAAAAAA\/a%22b\.png" width="400"/);
  assert.match(output, /src="assets\/AAAAAAAA\/a%26copy%3B\.png"/);
  assert.match(output, /\[encoded\]\(assets\/AAAAAAAA\/space%20name\.png\)/);
  assert.match(output, /\\!\[\[assets\/escaped\.png\]\]/);
  assert.match(output, /!\[\[Another note\]\]/);
  assert.deepEqual(
    plan.assets.map((asset) => asset.reference),
    [
      "figure.png",
      "assets/figure.png",
      "assets/Pasted image.png",
      'assets/a"b.png',
      "assets/a&copy;.png",
      "assets/space name.png",
    ],
  );
  assert.equal(plan.warnings.length, 1);
  const wiki = file(buildNoteExport([source]), source);
  assert.match(wiki, /!\[\[assets\/AAAAAAAA\/figure\.png\]\]/);
  assert.match(wiki, /!\[\[assets\/AAAAAAAA\/Pasted image\.png\|320\]\]/);
});

test("exportNoteLibrary writes a new directory and reports asset copy failures", async (t) => {
  const globals = globalThis as Record<string, any>;
  const previous = {
    Zotero: globals.Zotero,
    PathUtils: globals.PathUtils,
    IOUtils: globals.IOUtils,
    ztoolkit: globals.ztoolkit,
  };
  t.after(() => {
    clearNoteLibraries();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });

  const files = new Map<string, string | Uint8Array>();
  const directories = new Set(["/export", "/export/zotero-markdown-export"]);
  let failAssetRead = false;
  const sourcePath = "/zotero/first.md";
  const assetPath = "/zotero/assets/figure.png";
  files.set(
    sourcePath,
    "![figure](assets/figure.png)\n![sibling](same.png)\n![parent](../shared/image.png)\n![nested](pictures/image.png)",
  );
  files.set("/zotero/same.png", new Uint8Array([4]));
  files.set("/shared/image.png", new Uint8Array([5]));
  files.set("/zotero/pictures/image.png", new Uint8Array([6]));
  files.set(assetPath, new Uint8Array([1, 2, 3]));

  globals.PathUtils = {
    join: (base: string, ...parts: string[]) => {
      for (const part of parts) {
        if (!part || /[\\/\0]/.test(part) || part === "..")
          throw new Error(
            "PathUtils.join: Could not append to path: NS_ERROR_FILE_UNRECOGNIZED_PATH",
          );
      }
      return posix.join(base, ...parts);
    },
    parent: (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  };
  globals.IOUtils = {
    exists: async (path: string) => directories.has(path) || files.has(path),
    makeDirectory: async (
      path: string,
      options?: { ignoreExisting?: boolean },
    ) => {
      if (directories.has(path) && !options?.ignoreExisting) {
        throw new Error("directory exists");
      }
      directories.add(path);
    },
    stat: async (path: string) => ({
      type: directories.has(path) ? "directory" : "regular",
    }),
    read: async (path: string) => {
      if (failAssetRead && path === assetPath) {
        throw new Error("asset read failed");
      }
      const value = files.get(path);
      if (!(value instanceof Uint8Array)) throw new Error("missing source");
      return value;
    },
    write: async (path: string, value: Uint8Array) => {
      files.set(path, value);
      return value.byteLength;
    },
  };

  const item = {
    id: 1,
    key: "AAAAAAAA",
    libraryID: 1,
    attachmentFilename: "zmd-First.md",
    attachmentLinkMode: 0,
    attachmentContentType: "text/markdown",
    isAttachment: () => true,
    isTrashed: () => false,
    getField: () => "First.md",
    getDisplayTitle: () => "First",
    getFilePathAsync: async () => sourcePath,
  };
  globals.Zotero = {
    Libraries: { userLibraryID: 1 },
    Attachments: { LINK_MODE_LINKED_URL: 3 },
    Items: { getAll: async () => [item] },
    File: {
      getContentsAsync: async (path: string) => String(files.get(path) ?? ""),
      putContentsAsync: async (path: string, value: string) => {
        files.set(path, value);
      },
    },
  };
  globals.ztoolkit = {
    FilePicker: class {
      async open() {
        return "/export";
      }
    },
  };

  const first = await exportNoteLibrary({} as Window, 1, "markdown");
  assert.ok(first);
  assert.equal(first.directory, "/export/zotero-markdown-export-1");
  assert.equal(first.notes, 1);
  assert.ok(files.has(`${first.directory}/First--AAAAAAAA.md`));
  assert.deepEqual(
    Array.from(
      files.get(`${first.directory}/assets/AAAAAAAA/figure.png`) as Uint8Array,
    ),
    [1, 2, 3],
  );
  assert.equal(files.get("/export/zotero-markdown-export"), undefined);

  for (const [suffix, bytes] of [
    ["linked/2/same.png", [4]],
    ["linked/3/image.png", [5]],
    ["linked/4/image.png", [6]],
  ] as const) {
    assert.deepEqual(
      Array.from(
        files.get(`${first.directory}/assets/AAAAAAAA/${suffix}`) as Uint8Array,
      ),
      [...bytes],
    );
  }
  failAssetRead = true;
  const second = await exportNoteLibrary({} as Window, 1, "wiki");
  assert.ok(second);
  assert.equal(second.directory, "/export/zotero-markdown-export-2");
  assert.equal(second.notes, 1);
  assert.ok(
    second.warnings.some((message) => message.includes("asset read failed")),
  );
  assert.equal(
    files.get(`${second.directory}/assets/AAAAAAAA/figure.png`),
    undefined,
  );
  assert.match(
    String(files.get(`${second.directory}/REPORT.md`)),
    /asset read failed/,
  );
});

test("relative image exports isolate same names, normalize paths, and reject absolute sources", () => {
  const source = note(
    "AAAAAAAA",
    "First.md",
    [
      "![a](./figure.png)",
      "![b](pictures/figure.png)",
      "![c](../shared/figure.png)",
      "![repeat](pictures/./figure.png)",
      "![upper](assets/Figure.png)",
      "![lower](assets/figure.png)",
      "![absolute](/private/secret.png)",
      "![drive](C:/private/secret.png)",
      "![file](file:///private/secret.png)",
      "![other](../secret.txt)",
    ].join("\n"),
  );
  const plan = buildNoteExport([source]);
  assert.deepEqual(
    plan.assets.map((a) => a.reference),
    [
      "figure.png",
      "pictures/figure.png",
      "../shared/figure.png",
      "assets/Figure.png",
      "assets/figure.png",
    ],
  );
  assert.equal(new Set(plan.assets.map((a) => a.path.toLowerCase())).size, 5);
  assert.ok(plan.assets.every((a) => !a.path.includes("..")));
  assert.equal(plan.warnings.length, 4);
});

test("reference-style images copy their definition once without changing prose or code", () => {
  const source = note(
    "AAAAAAAA",
    "First.md",
    '![first][figure]\n![figure][]\n![figure]\n\n[figure]: <pictures/my image.png> "Title"\n\n`![code][hidden]`\n[hidden]: private.png\n',
  );
  const plan = buildNoteExport([source]);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0].reference, "pictures/my image.png");
  assert.match(
    file(plan, source),
    /\[figure\]: <assets\/AAAAAAAA\/linked\/1\/my%20image.png> "Title"/,
  );
  assert.match(file(plan, source), /\[hidden\]: private.png/);
  assert.match(file(plan, source), /!\[figure\]\[\]/);
});

test("inline image export rewrites original escaped destination spelling", () => {
  const source = note(
    "AAAAAAAA",
    "First.md",
    "![entity](assets/a&amp;b.png)\n![escaped](assets/a\\!b.png)\n![angle](<assets/a&amp;b.png>)",
  );
  const plan = buildNoteExport([source]);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(
    plan.assets.map((asset) => asset.reference),
    ["assets/a&b.png", "assets/a!b.png"],
  );
  assert.equal(
    file(plan, source),
    "![entity](assets/AAAAAAAA/a%26b.png)\n![escaped](assets/AAAAAAAA/a%21b.png)\n![angle](<assets/AAAAAAAA/a%26b.png>)",
  );
});

test("HTML image relocation rewrites only the first exact src attribute across all quoting forms", () => {
  const cases = [
    '<img data-src="preview.png" src="actual.png" alt="Figure">',
    '<img alt="src=other.png" src=actual.png>',
    "<img title=\"src='other.png'\" data-src=\"preview.png\" src='actual.png'>",
    '<IMG data-SRC=preview.png SRC = "actual.png" title="src=other.png">',
    '<img src="actual.png" src="unused.png">',
  ];
  for (const format of ["wiki", "markdown"] as const) {
    for (const input of cases) {
      const source = note("AAAAAAAA", "First.md", input);
      const plan = buildNoteExport([source], { format });
      assert.equal(
        file(plan, source),
        input.replace("actual.png", "assets/AAAAAAAA/linked/1/actual.png"),
      );
      assert.deepEqual(plan.warnings, []);
      assert.deepEqual(
        plan.assets.map((asset) => asset.reference),
        ["actual.png"],
      );
    }
  }
});

test("joint note export rewrites both an embedded image and its outer note-link destination", () => {
  const first = note(
    "AAAAAAAA",
    "First.md",
    '[![Figure](actual.png)](Other.md#Results "Open results")',
  );
  const other = note("BBBBBBBB", "Other.md", "# Results");
  for (const format of ["markdown", "wiki"] as const) {
    const plan = buildNoteExport([first, other], { format });
    assert.equal(
      file(plan, first),
      '[![Figure](assets/AAAAAAAA/linked/1/actual.png)](Other--BBBBBBBB.md#Results "Open results")',
    );
    assert.ok(plan.files.some((entry) => entry.path === "Other--BBBBBBBB.md"));
    assert.equal(plan.assets[0].path, "assets/AAAAAAAA/linked/1/actual.png");
    assert.deepEqual(plan.warnings, []);
  }
});
