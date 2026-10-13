import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import {
  createSourceFile,
  isFunctionDeclaration,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import { runShutdownSteps } from "../src/utils/shutdown.ts";

// Execute the real hook with host operations supplied by the test. Loading
// Zotero's complete sandbox is unnecessary for its teardown control flow.
const source = createSourceFile(
  "hooks.ts",
  readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8"),
  ScriptTarget.ES2022,
  true,
);
const shutdown = source.statements.find(
  (node) => isFunctionDeclaration(node) && node.name?.text === "onShutdown",
);
assert.ok(shutdown);
const { outputText: shutdownCode } = transpileModule(shutdown.getText(source), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
});

const operations = [
  "retainWorkspaceOnShutdown",
  "unregisterAttachmentIcons",
  "unregisterAllCreationToolbars",
  "closeAllMarkdownWindows",
  "flushAllSessions",
  "flushAllWhiteboards",
  "unregisterWhiteboardSidebar",
  "closeAllWhiteboards",
  "unregisterSidebarSection",
  "disposeMarkdownRenderer",
  "clearNoteLibraries",
  "closeNoteIndex",
  "unregisterFileOpenInterceptor",
  "unregisterWhiteboardFileOpenInterceptor",
  "unregisterMenus",
  "unregisterShortcuts",
] as const;

function setup(
  overrides: Record<string, () => unknown> = {},
  options: {
    tutorial?: Promise<void>;
    logThrows?: boolean;
    windows?: object[];
    unregisterWhiteboardMenus?: (win: object) => unknown;
  } = {},
) {
  const calls: string[] = [];
  const menuWindows: object[] = [];
  const reports: Array<{ message: string; error: unknown }> = [];
  const addon = {
    data: { alive: true, config: { addonInstance: "ScholarSketch" } },
  };
  const Zotero = {
    ScholarSketch: addon,
    getMainWindows: () => options.windows ?? [],
  };
  const context: Record<string, unknown> = {
    addon,
    Zotero,
    tutorialStartup: options.tutorial,
    runShutdownSteps,
    unregisterWhiteboardMenus: (win: object) => {
      calls.push("unregisterWhiteboardMenus");
      menuWindows.push(win);
      return options.unregisterWhiteboardMenus?.(win);
    },
    ztoolkit: {
      unregisterAll: () => {
        calls.push("unregisterAll");
        return overrides.unregisterAll?.();
      },
      log: (message: string, error: unknown) => {
        reports.push({ message, error });
        if (options.logThrows) throw new Error("Logger is unavailable");
      },
    },
  };
  for (const operation of operations) {
    context[operation] = () => {
      calls.push(operation);
      return overrides[operation]?.();
    };
  }
  const onShutdown = runInNewContext(
    `${shutdownCode}\nonShutdown;`,
    context,
  ) as () => Promise<void>;
  return { onShutdown, calls, menuWindows, reports, addon, Zotero, context };
}

test("shutdown waits for saving before unregistering and closing editors", async () => {
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fixture = setup({ flushAllWhiteboards: () => saving });
  const closing = fixture.onShutdown();
  await setImmediate();
  assert.deepEqual(
    fixture.calls,
    operations.slice(0, operations.indexOf("flushAllWhiteboards") + 1),
  );
  assert.equal(fixture.Zotero.ScholarSketch, fixture.addon);
  finish();
  await closing;
  assert.deepEqual(fixture.calls, [...operations, "unregisterAll"]);
  assert.deepEqual(fixture.reports, []);
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("snapshot and cleanup failures still remove every later registration and singleton", async () => {
  const saveError = new Error("snapshot timeout");
  const sidebarError = new Error("sidebar unregister failed");
  const indexError = new Error("index close failed");
  const draft = {
    dirty: true,
    content: "Unsaved local draft",
    editorAlive: true,
  };
  const fixture = setup({
    flushAllWhiteboards: async () => {
      throw saveError;
    },
    unregisterWhiteboardSidebar: () => {
      throw sidebarError;
    },
    closeAllWhiteboards: () => {
      // The normal close path declines to destroy an editor after save failure.
      assert.equal(draft.dirty, true);
    },
    closeNoteIndex: async () => {
      throw indexError;
    },
  });
  await fixture.onShutdown();
  assert.deepEqual(fixture.calls, [...operations, "unregisterAll"]);
  assert.deepEqual(
    fixture.reports.map(({ error }) => error),
    [saveError, sidebarError, indexError],
  );
  assert.deepEqual(
    fixture.reports.map(({ message }) => message),
    [
      "Shutdown cleanup failed (whiteboardSave)",
      "Shutdown cleanup failed (whiteboardSidebar)",
      "Shutdown cleanup failed (noteIndex)",
    ],
  );
  assert.deepEqual(draft, {
    dirty: true,
    content: "Unsaved local draft",
    editorAlive: true,
  });
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("rejected tutorial startup is cleared and cannot block later cleanup", async () => {
  const tutorialError = new Error("tutorial initialization failed");
  const fixture = setup({}, { tutorial: Promise.reject(tutorialError) });
  await fixture.onShutdown();
  assert.equal(fixture.context.tutorialStartup, undefined);
  assert.deepEqual(fixture.calls, [...operations, "unregisterAll"]);
  assert.equal(fixture.reports.length, 1);
  assert.equal(fixture.reports[0].error, tutorialError);
});

test("toolkit and logging failures still permit bootstrap chrome cleanup", async () => {
  const fixture = setup(
    {
      flushAllWhiteboards: async () => {
        throw new Error("snapshot timeout");
      },
      unregisterAll: () => {
        throw new Error("toolkit cleanup failed");
      },
    },
    { logThrows: true },
  );
  await fixture.onShutdown();
  // bootstrap.js destructs its chromeHandle only after this await succeeds.
  fixture.calls.push("chromeHandle.destruct");
  assert.equal(fixture.calls.at(-1), "chromeHandle.destruct");
  assert.equal(fixture.reports.length, 2);
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});

test("hot reload unregisters whiteboard menus in every window despite individual failures", async () => {
  const first = { id: "main-window-1" };
  const second = { id: "main-window-2" };
  const third = { id: "main-window-3" };
  const firstError = new Error("First window menu cleanup failed");
  const secondError = new Error("Second window menu cleanup failed");
  const fixture = setup(
    {},
    {
      windows: [first, second, third],
      unregisterWhiteboardMenus: (win) => {
        if (win === first) throw firstError;
        if (win === second) return Promise.reject(secondError);
      },
      logThrows: true,
    },
  );
  await fixture.onShutdown();
  assert.deepEqual(fixture.menuWindows, [first, second, third]);
  const whiteboardFileHandler = fixture.calls.indexOf(
    "unregisterWhiteboardFileOpenInterceptor",
  );
  assert.deepEqual(fixture.calls.slice(whiteboardFileHandler + 1), [
    "unregisterWhiteboardMenus",
    "unregisterWhiteboardMenus",
    "unregisterWhiteboardMenus",
    "unregisterMenus",
    "unregisterShortcuts",
    "unregisterAll",
  ]);
  assert.deepEqual(
    fixture.reports.map(({ error }) => error),
    [firstError, secondError],
  );
  assert.deepEqual(
    fixture.reports.map(({ message }) => message),
    [
      "Shutdown cleanup failed (whiteboardMenus:window-1)",
      "Shutdown cleanup failed (whiteboardMenus:window-2)",
    ],
  );
  assert.equal(fixture.addon.data.alive, false);
  assert.equal(Object.hasOwn(fixture.Zotero, "ScholarSketch"), false);
});
