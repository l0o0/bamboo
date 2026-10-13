import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acquireAcademicItems,
  dataUrlToBytes,
  parseDroppedItemIDs,
  resolveNativeAcademicDrop,
} from "../src/modules/whiteboard/tab.ts";
import * as tabModule from "../src/modules/whiteboard/tab.ts";

const tab = readFileSync(
  new URL("../src/modules/whiteboard/tab.ts", import.meta.url),
  "utf8",
);
const session = readFileSync(
  new URL("../src/modules/whiteboard/session-registry.ts", import.meta.url),
  "utf8",
);
const hooks = readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8");
const tabHooks = readFileSync(
  new URL("../src/modules/whiteboard/tabHooks.ts", import.meta.url),
  "utf8",
);
const create = readFileSync(
  new URL("../src/modules/whiteboard/create.ts", import.meta.url),
  "utf8",
);
const architecture = readFileSync(
  new URL("../docs/architecture.md", import.meta.url),
  "utf8",
);

test("whiteboard sessions own a save coordinator", () => {
  assert.match(session, /saveCoordinator\?: WhiteboardSaveCoordinator/);
  assert.match(tab, /new WhiteboardSaveCoordinator\(/);
  assert.ok(
    tab.indexOf("session.saveCoordinator = new WhiteboardSaveCoordinator") <
      tab.indexOf("session.editor = createWhiteboardEditor"),
  );
});

test("all save entry points call the coordinator", () => {
  assert.match(tab, /saveCoordinator\?\.markChanged\(rev\)/);
  assert.match(tab, /saveCoordinator\.request\(/);
  assert.match(tab, /saveCoordinator\?\.flush\(\)/);
  assert.doesNotMatch(tab, /session\.savedRev\s*=/);
});

test("host persistence uses only schema-v2 canvas APIs", () => {
  assert.match(tab, /readCanvasFile/);
  assert.match(tab, /persistCanvasAttachment/);
  assert.match(tab, /parseCanvasDocument/);
  assert.match(tab, /for \(const issue of parsed\.issues\)/);
  assert.match(tab, /issue\.code/);
  assert.match(tab, /issue\.id/);
  assert.match(tab, /mountWhiteboardUI\([^)]*parsed\.document/s);
});

test("autosave and close-before-flush ordering remain unchanged", () => {
  assert.match(tab, /const AUTOSAVE_MS = 800/);
  const closeStart = tab.indexOf("export function closeWhiteboardSession");
  assert.ok(closeStart >= 0);
  const closeBody = tab.slice(closeStart);
  assert.ok(closeBody.indexOf("clearTimeout") < closeBody.indexOf("flush()"));
  assert.ok(
    closeBody.indexOf("flush()") <
      closeBody.indexOf("disposeWhiteboardSession(session)"),
  );
});

test("plugin shutdown flushes canvases before closing them", () => {
  assert.match(hooks, /await flushAllWhiteboards\(\)/);
  assert.ok(
    hooks.indexOf("await flushAllWhiteboards()") <
      hooks.indexOf("await closeAllWhiteboards()"),
  );
});

function statementIndex(
  source: string,
  pattern: RegExp,
  label: string,
): number {
  const index = pattern.exec(source)?.index ?? -1;
  assert.ok(index >= 0, `missing ${label}`);
  return index;
}

test("plugin owns tutorial onboarding across startup and shutdown", () => {
  assert.match(
    hooks,
    /import\s*\{[\s\S]*ensureTutorialWhiteboard[\s\S]*\}\s*from "\.\/modules\/whiteboard"/,
  );
  assert.match(hooks, /^let tutorialStartup: Promise<void> \| undefined;$/m);
  assert.doesNotMatch(hooks, /await ensureTutorialWhiteboard\(\)/);

  const startup = hooks.slice(
    hooks.indexOf("async function onStartup"),
    hooks.indexOf("async function onMainWindowLoad"),
  );
  const tutorial = statementIndex(
    startup,
    /^\s*tutorialStartup = ensureTutorialWhiteboard\(\);$/m,
    "non-awaited tutorial assignment",
  );
  for (const [label, pattern] of [
    ["initLocale()", /^\s*initLocale\(\);$/m],
    [
      "onMainWindowLoad(win)",
      /^\s*Zotero\.getMainWindows\(\)\.map\(\(win\) => onMainWindowLoad\(win\)\),$/m,
    ],
    ["registerSidebarSection()", /^\s*registerSidebarSection\(\);$/m],
  ] as const) {
    assert.ok(
      statementIndex(startup, pattern, label) < tutorial,
      `tutorial must follow ${label}`,
    );
  }

  const shutdown = hooks.slice(
    hooks.indexOf("async function onShutdown"),
    hooks.indexOf("function registerPrefs"),
  );
  const drain = statementIndex(
    shutdown,
    /^\s*await tutorialStartup;$/m,
    "tutorial shutdown drain",
  );
  const clear = statementIndex(
    shutdown,
    /^\s*tutorialStartup = undefined;$/m,
    "tutorial promise clear",
  );
  const teardown = statementIndex(
    shutdown,
    /^\s*await closeAllMarkdownWindows\(\);$/m,
    "first shutdown teardown",
  );
  assert.ok(drain < clear && clear < teardown);
});

test("tab title hooks derive dirty state from the coordinator", () => {
  assert.match(tabHooks, /session\.saveCoordinator\?\.dirty/);
  assert.doesNotMatch(tabHooks, /session\.(currentRev|savedRev)/);
});

test("collection Zotero Notes become source-backed Academic Notes without integer ids", () => {
  assert.match(create, /createAcademicNode\(\s*"note"/);
  assert.match(create, /source: acquisition\.source/);
  assert.match(create, /content:/);
  assert.doesNotMatch(create, /noteID/);
});

test("architecture limits the no-local-ID promise to Academic source data", () => {
  assert.match(
    architecture,
    /Academic source descriptors and\s+protocol payloads[\s\S]*never[\s\S]*local integer item IDs/,
  );
  assert.doesNotMatch(
    architecture,
    /canonical model stores[\s\S]{0,100}never Zotero objects or[\s\S]{0,50}local integer item IDs/,
  );
});

test("new Zotero acquisition uses the academic gateway for file attachments", () => {
  assert.match(tab, /createZoteroSourceGateway\(\)/);
  assert.match(tab, /gateway\.acquireItem\(item\)/);
  assert.match(tab, /onPickAcademicSource/);
  assert.match(tab, /onDropAcademicSources/);
  assert.doesNotMatch(tab, /promptPageNumber/);
  assert.doesNotMatch(tab, /renderPdfPageToDataUrl/);
  assert.doesNotMatch(tab, /editor\.resolvePick/);
  assert.doesNotMatch(tab, /editor\.rejectPick/);
});

test("generic Zotero acquisition accepts Notes and attachments through the source gateway", () => {
  assert.match(
    tab,
    /item\.isRegularItem\?\.\(\)\s*\|\|\s*item\.isNote\?\.\(\)\s*\|\|\s*item\.isAttachment\?\.\(\)/,
  );
  assert.match(tab, /gateway\.acquireItem\(item\)/);
  assert.match(tab, /gateway\.refreshNote\(source\)/);
  assert.match(tab, /applyNoteRefresh/);
});

test("production Zotero item drops use one canonical payload and preserve its order", () => {
  const transfer = (data: Record<string, string>) => {
    const value = { ...data } as Record<string, string> & {
      types: string[];
      getData(type: string): string;
    };
    Object.defineProperties(value, {
      types: { value: Object.keys(data), enumerable: false },
      getData: {
        value: (type: string) => data[type] ?? "",
        enumerable: false,
      },
    });
    return value;
  };
  assert.deepEqual(
    parseDroppedItemIDs(
      transfer({
        "text/plain": "12,13",
        "zotero/item": "11,11,12",
        "application/json": "[14]",
      }),
    ),
    [11, 11, 12],
    "mirrored MIME flavors cannot multiply or reorder canonical entries",
  );
  assert.deepEqual(
    parseDroppedItemIDs(
      transfer({ "zotero/collection": "7", "zotero/item": "11,12" }),
    ),
    [],
    "Zotero's collection > item > search precedence rejects a mixed collection drag",
  );
  assert.deepEqual(
    parseDroppedItemIDs(
      transfer({ "application/json": "[11,12]", "text/plain": "11,12" }),
    ),
    [],
    "arbitrary MIME payloads are not interpreted as Zotero item IDs",
  );
});

test("production academic request failures log typed context and raw diagnostics", () => {
  const reportAcademicRequestFailure = (
    tabModule as typeof tabModule & {
      reportAcademicRequestFailure?: (
        detail: Record<string, string>,
        log: (...args: unknown[]) => void,
      ) => void;
    }
  ).reportAcademicRequestFailure;
  assert.equal(typeof reportAcademicRequestFailure, "function");
  const entries: unknown[][] = [];
  reportAcademicRequestFailure!(
    {
      operation: "picker",
      requestId: "pick-7",
      nodeId: "node-7",
      code: "picker-failed",
      diagnostic: "private host exception",
    },
    (...args) => entries.push(args),
  );
  assert.deepEqual(entries, [
    [
      "Academic source picker failed",
      {
        operation: "picker",
        requestId: "pick-7",
        nodeId: "node-7",
        code: "picker-failed",
        diagnostic: "private host exception",
      },
    ],
  ]);
  const pickerPath = tab.slice(
    tab.indexOf("async function handlePickAcademicSource"),
    tab.indexOf("function openZoteroItem"),
  );
  assert.match(pickerPath, /reportAcademicRequestFailure\(\{/);

  const rejected = resolveNativeAcademicDrop(
    {
      types: ["zotero/item"],
      getData: () => {
        throw new Error("native transfer exception");
      },
    },
    { userLibraryID: 1, getItem: () => null, getLibrary: () => null },
  );
  assert.deepEqual(rejected, {
    status: "rejected",
    code: "drop-malformed",
    diagnostic: "native transfer exception",
  });
  if (rejected.status === "rejected") {
    reportAcademicRequestFailure!(
      {
        operation: "drop",
        requestId: "drop-8",
        code: rejected.code,
        diagnostic: rejected.diagnostic,
      },
      (...args) => entries.push(args),
    );
  }
  assert.deepEqual(entries.at(-1), [
    "Academic source drop failed",
    {
      operation: "drop",
      requestId: "drop-8",
      code: "drop-malformed",
      diagnostic: "native transfer exception",
    },
  ]);
  const mountPath = tab.slice(
    tab.indexOf("function mountWhiteboardUI"),
    tab.indexOf("export async function openWhiteboard"),
  );
  assert.match(
    mountPath,
    /onNativeAcademicDropRejected[\s\S]*reportAcademicRequestFailure/,
  );
});

test("host resolves ordered Zotero ids to native user/group keys before protocol crossing", () => {
  const payloads = new Map([
    ["zotero/item", "11,12,11"],
    ["text/plain", "12,11"],
  ]);
  const result = resolveNativeAcademicDrop(
    {
      types: [...payloads.keys()],
      getData: (type) => payloads.get(type) ?? "",
    },
    {
      userLibraryID: 1,
      getItem(itemID) {
        if (itemID === 11)
          return {
            key: "PAPER123",
            libraryID: 1,
            isRegularItem: () => true,
            isAttachment: () => false,
          } as Zotero.Item;
        if (itemID === 12)
          return {
            key: "PDF12345",
            libraryID: 5,
            isRegularItem: () => false,
            isAttachment: () => true,
          } as Zotero.Item;
        return null;
      },
      getLibrary(libraryID) {
        return libraryID === 5 ? { libraryType: "group", groupID: 88 } : null;
      },
    },
  );

  assert.deepEqual(result, {
    status: "accepted",
    sources: [
      { library: { type: "user" }, itemKey: "PAPER123" },
      {
        library: { type: "group", groupID: 88 },
        attachmentKey: "PDF12345",
      },
      { library: { type: "user" }, itemKey: "PAPER123" },
    ],
  });
  assert.equal(JSON.stringify(result).includes("itemID"), false);
  assert.deepEqual(
    resolveNativeAcademicDrop(
      { types: ["zotero/item"], getData: () => "11,broken" },
      { userLibraryID: 1, getItem: () => null, getLibrary: () => null },
    ),
    { status: "rejected", code: "drop-malformed" },
  );
});

test("generic Zotero batches acquire supported inputs independently and retain source indexes", async () => {
  const item = (
    kind: "regular" | "note" | "attachment" | "other",
    key: string,
  ) =>
    ({
      key,
      isRegularItem: () => kind === "regular",
      isNote: () => kind === "note",
      isAttachment: () => kind === "attachment",
      isAnnotation: () => false,
    }) as unknown as Zotero.Item;
  const calls: string[] = [];
  const result = await acquireAcademicItems(
    [
      item("regular", "FIRST123"),
      item("attachment", "PDF12345"),
      item("regular", "FIRST123"),
      item("note", "NOTE1234"),
    ],
    {
      async acquireItem(input) {
        calls.push(input.key);
        await Promise.resolve();
        return input.isNote()
          ? {
              kind: "note" as const,
              source: {
                library: { type: "user" as const },
                noteKey: input.key,
              },
              content: "Imported note",
            }
          : input.isAttachment()
            ? {
                kind: "attachment" as const,
                source: {
                  library: { type: "user" as const },
                  attachmentKey: input.key,
                },
                snapshot: {
                  filename: `${input.key}.pdf`,
                  contentType: "application/pdf",
                  availability: "available" as const,
                },
              }
            : {
                kind: "literature" as const,
                source: {
                  library: { type: "user" as const },
                  itemKey: input.key,
                },
                snapshot: { title: input.key },
              };
      },
    },
  );

  assert.deepEqual(calls, ["FIRST123", "PDF12345", "FIRST123", "NOTE1234"]);
  assert.deepEqual(
    result.successes.map(({ index, acquisition }) => [index, acquisition.kind]),
    [
      [0, "literature"],
      [1, "attachment"],
      [2, "literature"],
      [3, "note"],
    ],
  );
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.successes.filter(
      ({ acquisition }) => acquisition.kind === "literature",
    ).length,
    2,
  );
  assert.equal(
    result.successes.some(({ acquisition }) => acquisition.kind === "quote"),
    false,
  );
  assert.equal(
    result.successes.filter(({ acquisition }) => acquisition.kind === "note")
      .length,
    1,
  );
  assert.equal(
    result.successes.filter(
      ({ acquisition }) => acquisition.kind === "attachment",
    ).length,
    1,
  );
});

test("a supported item acquisition failure is indexed without cancelling its peers", async () => {
  const regular = (key: string) =>
    ({
      key,
      isRegularItem: () => true,
      isNote: () => false,
      isAttachment: () => false,
    }) as unknown as Zotero.Item;
  const result = await acquireAcademicItems(
    [regular("GOOD1234"), regular("BROKEN12"), regular("NEXT1234")],
    {
      acquireItem(input) {
        if (input.key === "BROKEN12") throw new Error("Cannot snapshot");
        return {
          kind: "literature",
          source: { library: { type: "user" }, itemKey: input.key },
          snapshot: { title: input.key },
        };
      },
    },
  );

  assert.deepEqual(
    result.successes.map((success) => success.index),
    [0, 2],
  );
  assert.deepEqual(result.failures, [
    { index: 1, code: "acquisition-failed", message: "Cannot snapshot" },
  ]);
});

test("collection generation builds source-key Literature without PDF traversal", () => {
  const collectionStart = create.indexOf(
    "export function buildCollectionCanvas",
  );
  const collectionEnd = create.indexOf(
    "export async function createWhiteboardFromCollection",
  );
  const collectionBody = create.slice(collectionStart, collectionEnd);
  assert.match(collectionBody, /gateway\.acquireItem\(item\)/);
  assert.match(collectionBody, /createAcademicNode\(\s*"literature"/);
  assert.doesNotMatch(collectionBody, /getAttachments\(/);
  assert.doesNotMatch(collectionBody, /createBasicNode\(\s*"pdf"/);
});

test("SVG export decodes UTF-8 data URLs without losing Chinese or XML characters", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><text>中文 &amp; &lt;测试&gt; 😀</text></svg>';
  const result = dataUrlToBytes(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  assert.ok(result);
  assert.equal(result.mimeType, "image/svg+xml");
  assert.equal(new TextDecoder().decode(result.bytes), svg);
  assert.deepEqual(
    dataUrlToBytes(`data:image/svg+xml,${encodeURIComponent(svg)}`)?.bytes,
    result.bytes,
  );
});

test("image export still decodes base64 PNG bytes", () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const header of ["image/png;base64", "image/png;charset=utf-8;base64"]) {
    const result = dataUrlToBytes(`data:${header},iVBORw0KGgo=`);
    assert.deepEqual(result?.bytes, bytes);
    assert.equal(result?.mimeType, "image/png");
  }
  assert.equal(dataUrlToBytes("not a data URL"), null);
});
