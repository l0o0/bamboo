import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { Window } from "happy-dom";
import {
  createMarkdownEditor,
  type MarkdownEditorHandle,
} from "../src/modules/markdown/editor.ts";
import {
  extractFirstHeadingTitle,
  frontmatterTitleChange,
  parseFrontmatter,
} from "../src/modules/markdown/frontmatter.ts";
import {
  applyDocChanges,
  computeStats,
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  type EditorToParentMessage,
  type ParentToEditorMessage,
} from "../src/modules/markdown/editor-protocol.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";

const file = new URL("../src/modules/markdown/tab.ts", import.meta.url);
const source = ts.createSourceFile(
  file.pathname,
  readFileSync(file, "utf8"),
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const functions = new Map<string, ts.FunctionDeclaration>();
for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    functions.set(statement.name.text, statement);
  }
}

function editorCallbacks(tree = source) {
  let options: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createMarkdownEditor" &&
      node.arguments[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      options = node.arguments[1];
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(options, "The real editor option callbacks are present");
  const callback = (name: string) => {
    const property = options.properties.find(
      (node) =>
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name,
    );
    assert.ok(property && ts.isPropertyAssignment(property));
    assert.ok(ts.isArrowFunction(property.initializer));
    return property.initializer;
  };
  return {
    onChange: callback("onChange"),
    onSave: callback("onSave"),
    onCompositionChange: callback("onCompositionChange"),
  };
}

function toolbarSaveListener() {
  let listener: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "root" &&
      node.expression.name.text === "addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "click" &&
      ts.isArrowFunction(node.arguments[1])
    )
      listener = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(listener, "The actual delegated toolbar click listener exists");
  return listener;
}

function documentSyncFlush() {
  let flush: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "documentSyncRegistry" &&
      node.expression.name.text === "register" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "flush" &&
          ts.isArrowFunction(property.initializer)
        )
          flush = property.initializer;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functions.get("bindSessionDocumentSync")!);
  assert.ok(flush, "The actual document synchronization flush callback exists");
  return flush;
}

// Extract real callback/helper ASTs, retaining their implementation and only
// replacing unrelated IO/UI boundaries. These are behavior tests, not source-string checks.
function executableScheduling() {
  const callbacks = editorCallbacks();
  const included = new Set<string>();
  const boundaries = new Set([
    "persistSession",
    "scheduleImageAssetRefresh",
    "setStatus",
    "updateSaveStatus",
    // Toolbar dispatch remains real; these unrelated modal/editor UI paths
    // are outside the save/title scheduling fixture.
    "setMode",
    "showReadOnlyPreview",
    "toggleMoreMenu",
    "toggleTablePicker",
    "chooseAndInsertImage",
  ]);
  const includeDependencies = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      functions.has(node.expression.text) &&
      !boundaries.has(node.expression.text)
    ) {
      includeFunction(node.expression.text);
    }
    ts.forEachChild(node, includeDependencies);
  };
  const includeFunction = (name: string) => {
    if (included.has(name)) return;
    const node = functions.get(name);
    assert.ok(node, `Scheduling helper ${name} exists`);
    included.add(name);
    includeDependencies(node);
  };
  includeFunction("closeMarkdownSession");
  includeFunction("createSessionSave");
  includeDependencies(callbacks.onChange);
  includeDependencies(callbacks.onSave);
  includeDependencies(callbacks.onCompositionChange);
  includeDependencies(toolbarSaveListener());
  includeDependencies(documentSyncFlush());

  const printer = ts.createPrinter();
  const constants = source.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
          .filter(
            (node) =>
              ts.isIdentifier(node.name) &&
              node.initializer &&
              (ts.isNumericLiteral(node.initializer) ||
                node.name.text === "metaUpdateTimers" ||
                node.name.text === "titleSaveOwners" ||
                node.name.text === "responsiveToolbars" ||
                node.name.text === "readOnlySessions"),
          )
          .map((node) => `const ${node.getText(source)};`)
      : [],
  );
  const declarations = [...included].map((name) => {
    const node = functions.get(name)!;
    const local = ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers?.filter(
        (modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword,
      ),
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      node.body,
    );
    return printer.printNode(ts.EmitHint.Unspecified, local, source);
  });
  const code = [
    ...constants,
    ...declarations,
    `globalThis.callbacks = { onChange: ${callbacks.onChange.getText(source)}, onSave: ${callbacks.onSave.getText(source)}, onCompositionChange: ${callbacks.onCompositionChange.getText(source)}, toolbarClick: ${toolbarSaveListener().getText(source)}, documentFlush: ${documentSyncFlush().getText(source)}, createSave: createSessionSave, close: closeMarkdownSession };`,
  ].join("\n");
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
}

const executable = executableScheduling();

function fakeClock() {
  let now = 0;
  let nextID = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout(run: () => void, delay: number) {
      const id = nextID++;
      pending.set(id, { at: now + delay, run });
      return id;
    },
    clearTimeout(id: number) {
      pending.delete(id);
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        pending.delete(id);
        timer.run();
      }
      now = target;
    },
    pending,
  };
}

function fixture(initial = "# Untitled\n\nBody") {
  const clock = fakeClock();
  let value = initial;
  let statsReads = 0;
  let titleScans = 0;
  let marked = 0;
  let dirty = false;
  let composing = false;
  let destroyed = 0;
  let registered = true;
  let saveError: Error | undefined;
  let beforeWrite: (() => Promise<void>) | undefined;
  let readSaveSnapshot: (() => Promise<string>) | undefined;
  let echoed = false;
  const events: string[] = [];
  const replacements: { from: number; to: number; insert: string }[] = [];
  const saved: { value: string; force: boolean }[] = [];
  const requests: { force: boolean; promise: Promise<void> }[] = [];
  const meta = { textContent: "" };
  const reportedErrors: unknown[] = [];
  const requestSave = async (
    _session: unknown,
    options: { force?: boolean } = {},
  ) => {
    events.push("save");
    if (saveError) throw saveError;
    const savedValue = readSaveSnapshot ? await readSaveSnapshot() : value;
    saved.push({ value: savedValue, force: !!options.force });
    dirty = false;
  };
  const session = {
    itemID: 42,
    tabID: "test-tab",
    mode: "live",
    win: clock,
    view: { metaEl: meta },
    save: {
      get dirty() {
        return dirty;
      },
      markChanged() {
        marked++;
        dirty = true;
      },
      request(options: { force?: boolean }) {
        return requestSave(session, options);
      },
    },
    editor: {
      isComposing: () => composing,
      getValue: () => value,
      getStats() {
        statsReads++;
        return computeStats(value);
      },
      replaceRange(from: number, to: number, insert: string) {
        events.push("replaceRange");
        replacements.push({ from, to, insert });
        value = value.slice(0, from) + insert + value.slice(to);
        echoed = false;
      },
      setValue() {
        throw new Error(
          "Title synchronization must preserve undo through replaceRange",
        );
      },
      destroy() {
        destroyed++;
        events.push("destroy");
      },
    },
  };
  const context = createContext({
    session,
    requestSave,
    SaveCoordinator,
    persistSession: async (
      _session: unknown,
      snapshot: string,
      options: { force: boolean },
    ) => {
      events.push("persist");
      if (saveError) throw saveError;
      await beforeWrite?.();
      saved.push({ value: snapshot, force: options.force });
    },
    addon: { data: { config: { addonName: "Test product" } } },
    ztoolkit: {
      log(_message: string, error: unknown) {
        reportedErrors.push(error);
      },
      ProgressWindow: class {
        createLine() {
          return this;
        }
        show() {
          return this;
        }
      },
    },
    getString: (key: string) => key,
    setStatus() {},
    updateSaveStatus() {},
    scheduleImageAssetRefresh() {},
    documentSyncRegistry: { markEdited() {} },
    extractFirstHeadingTitle(text: string) {
      titleScans++;
      return extractFirstHeadingTitle(text);
    },
    frontmatterTitleChange,
    formatStats: (stats: ReturnType<typeof computeStats>) =>
      JSON.stringify(stats),
    sessionRegistry: {
      get: () => (registered ? session : undefined),
      unregister() {
        registered = false;
      },
      all: () => (registered ? [session] : []),
    },
    forgetOpenDocument() {},
  });
  runInContext(executable, context, {
    filename: "real-tab-change-scheduling.js",
  });
  const callbacks = context.callbacks as {
    onChange: (value: string) => void;
    onSave: () => void;
    onCompositionChange: (active: boolean) => void;
    close: (
      id: string,
      options?: { flush?: boolean; throwOnSaveError?: boolean },
    ) => Promise<void>;
    toolbarClick: (event: Event) => void;
    documentFlush: () => Promise<void>;
    createSave: (session: unknown) => SaveCoordinator;
  };
  return {
    clock,
    session,
    events,
    replacements,
    saved,
    meta,
    type(next: string) {
      value = next;
      callbacks.onChange(value);
    },
    compose(active: boolean) {
      composing = active;
      callbacks.onCompositionChange(active);
    },
    echoReplacement() {
      assert.equal(echoed, false);
      echoed = true;
      callbacks.onChange(value);
    },
    explicitSave: callbacks.onSave,
    close: (options?: { flush?: boolean; throwOnSaveError?: boolean }) =>
      callbacks.close(session.tabID, options),
    failSave(error: Error) {
      saveError = error;
    },
    holdNextWrite() {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve));
      beforeWrite = async () => {
        beforeWrite = undefined;
        await blocked;
      };
      return release;
    },
    useEditor(editor: MarkdownEditorHandle) {
      session.editor = editor as unknown as typeof session.editor;
      readSaveSnapshot = editor.requestSnapshot;
    },
    useCoordinator() {
      const coordinator = callbacks.createSave(session);
      const request = coordinator.request.bind(coordinator);
      coordinator.request = (options = {}) => {
        const promise = request(options);
        requests.push({ force: !!options.force, promise });
        return promise;
      };
      session.save = coordinator as unknown as typeof session.save;
      return coordinator;
    },
    bindToolbar(root: HTMLElement) {
      context.root = root;
      root.addEventListener("click", callbacks.toolbarClick);
    },
    documentFlush: callbacks.documentFlush,
    reportedErrors,
    requests,
    clearFailure() {
      saveError = undefined;
    },
    get value() {
      return value;
    },
    get statsReads() {
      return statsReads;
    },
    get titleScans() {
      return titleScans;
    },
    get marked() {
      return marked;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

test("a burst of input coalesces exact metadata once after 120ms without scanning headings per key", () => {
  const f = fixture();
  f.type("# First\n\n中文");
  f.clock.advance(35);
  f.type("# Second\n\n中文 alpha");
  f.clock.advance(40);
  f.type("# Third\n\n中文 alpha beta");
  f.clock.advance(40);
  f.type("# Latest\n\n中文 alpha beta 😀");
  assert.equal(f.statsReads, 0);
  assert.equal(f.titleScans, 0);
  assert.equal(f.marked, 4);
  f.clock.advance(119);
  assert.equal(f.statsReads, 0);
  f.clock.advance(1);
  assert.equal(f.statsReads, 1);
  assert.deepEqual(JSON.parse(f.meta.textContent), computeStats(f.value));
  assert.equal(
    f.titleScans,
    0,
    "Scheduling does not inspect the complete body",
  );
});

test("autosave at 800ms flushes the pending title once and saves after its range-change echo", () => {
  const f = fixture();
  f.type("---\ntitle: Old\n---\n\n# Latest\n\nKeep this paragraph.");
  f.clock.advance(799);
  assert.equal(f.titleScans, 0);
  assert.equal(f.saved.length, 0);
  f.clock.advance(1);
  assert.equal(f.titleScans, 1);
  assert.equal(f.replacements.length, 1);
  assert.equal(
    f.saved.length,
    0,
    "The iframe has not echoed the title edit yet",
  );
  assert.equal(parseFrontmatter(f.value).data.title, "Latest");
  assert.ok(f.value.endsWith("Keep this paragraph."));
  f.echoReplacement();
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].value, f.value);
  assert.equal(f.saved[0].force, false);
  assert.deepEqual(f.events, ["replaceRange", "save"]);
  f.clock.advance(1200);
  assert.equal(
    f.titleScans,
    1,
    "The superseded 1000ms title timer does not run again",
  );
  assert.equal(f.saved.length, 1);
});

test("autosave still runs on time when no frontmatter title replacement is needed", () => {
  const f = fixture();
  f.type("# Already current\n\nPlain body without frontmatter.");
  f.clock.advance(800);
  assert.equal(f.titleScans, 1);
  assert.equal(f.replacements.length, 0);
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].value, f.value);
  f.clock.advance(1000);
  assert.equal(f.saved.length, 1);
});

test("explicit save flushes title immediately and preserves the forced save through the change echo", () => {
  const f = fixture();
  f.type("---\ntitle: Before\n---\n\n# Save now\n\nBody");
  f.explicitSave();
  assert.equal(f.titleScans, 1);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.saved.length, 0);
  f.echoReplacement();
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Save now");
});

test("successful close cancels pending metadata and document timers after the final save", async () => {
  const f = fixture();
  f.type("# Pending\n\nClose this body");
  assert.ok(f.clock.pending.size > 0);
  await f.close({ flush: true });
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(f.destroyed, 1);
  assert.deepEqual(f.events, ["save", "destroy"]);
  assert.equal(f.clock.pending.size, 0);
  const titleScansAtClose = f.titleScans;
  f.clock.advance(5000);
  assert.equal(f.statsReads, 0);
  assert.equal(f.titleScans, titleScansAtClose);
  assert.equal(f.saved.length, 1);
});

test("a rejected close save preserves the editor and pending scheduling for recovery", async () => {
  const f = fixture();
  f.type("# Unsaved\n\nKeep this recoverable body");
  f.failSave(new Error("synthetic save failure"));
  await assert.rejects(
    f.close({ flush: true, throwOnSaveError: true }),
    /synthetic save failure/,
  );
  assert.equal(f.destroyed, 0);
  assert.ok(f.clock.pending.size > 0);
  f.clock.advance(120);
  assert.equal(f.statsReads, 1);
  assert.deepEqual(JSON.parse(f.meta.textContent), computeStats(f.value));
});

function editorPeer(
  testContext: import("node:test").TestContext,
  f: ReturnType<typeof fixture>,
  options: { holdMessages?: boolean } = {},
) {
  const value = f.value;
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  globals.Zotero = { Prefs: { get: () => undefined } };
  globals.ztoolkit = { log() {} };
  const window = new Window({
    url: "https://close.test/",
    settings: { disableIframePageLoading: true },
  });
  const frame = new Window({ url: "https://close.test/frame/" });
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  const editor = createMarkdownEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    pageURL: "https://close.test/editor.html",
    channel: "close-title-test",
    doc: value,
    onChange: (next) => f.type(next),
    onCompositionChange: (active) => f.compose(active),
  });
  const iframe = parent.querySelector("iframe")!;
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  testContext.after(async () => {
    editor.destroy();
    await frame.happyDOM.close();
    await window.happyDOM.close();
    for (const key of Object.keys(globals)) {
      if (!Object.hasOwn(previous, key)) delete globals[key];
    }
    for (const [key, descriptor] of Object.entries(previous)) {
      if (Object.getOwnPropertyDescriptor(globalThis, key)?.configurable) {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  });
  const send = (message: EditorToParentMessage) => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: frame,
        data: {
          ...message,
          source: EDITOR_MESSAGE_SOURCE,
          channel: "close-title-test",
          v: EDITOR_PROTOCOL_VERSION,
        },
      }),
    );
  };
  let frontend = value;
  let mirrorAtFirstSnapshot: string | undefined;
  const commands: string[] = [];
  const held: (() => void)[] = [];
  let holdMessages = !!options.holdMessages;
  frame.postMessage = ((message: ParentToEditorMessage) => {
    commands.push(message.type);
    if (
      message.type === "requestSnapshot" &&
      mirrorAtFirstSnapshot === undefined
    ) {
      mirrorAtFirstSnapshot = editor.getValue();
    }
    // Model only the ordered message peer, retaining the actual parent bridge
    // and actual tab close/title implementation. No iframe page or UI is loaded.
    const deliver = () => {
      if (message.type === "init") frontend = message.payload.doc;
      if (message.type === "replaceRange") {
        const change = message.payload;
        frontend = applyDocChanges(frontend, [change]);
        send({
          source: EDITOR_MESSAGE_SOURCE,
          type: "change",
          payload: { rev: 1, changes: [change] },
        });
      }
      if (message.type === "requestSnapshot") {
        send({
          source: EDITOR_MESSAGE_SOURCE,
          type: "snapshot",
          payload: {
            requestId: message.payload.requestId,
            rev: 1,
            value: frontend,
            stats: computeStats(frontend),
          },
        });
      }
    };
    if (holdMessages) held.push(deliver);
    else queueMicrotask(deliver);
  }) as typeof frame.postMessage;
  send({ source: EDITOR_MESSAGE_SOURCE, type: "ready" });
  f.useEditor(editor);
  return {
    editor,
    window,
    parent,
    commands,
    compose(active: boolean) {
      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: "composition",
        payload: { active },
      });
    },
    change(value: string) {
      const changes = [{ from: 0, to: frontend.length, insert: value }];
      frontend = value;
      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: "change",
        payload: { rev: 1, changes },
      });
    },
    releaseMessages() {
      holdMessages = false;
      for (const deliver of held.splice(0)) deliver();
    },
    get mirrorAtFirstSnapshot() {
      return mirrorAtFirstSnapshot;
    },
  };
}

test("close flushes pending title before the real editor bridge requests its final snapshot", async (testContext) => {
  const value = "---\ntitle: Old\n---\n\n# Latest\n\nKeep this paragraph.";
  const f = fixture(value);
  const peer = editorPeer(testContext, f);
  f.type(value);
  await f.close({ flush: true });
  const writeCommands = peer.commands.filter(
    (type) => type === "replaceRange" || type === "requestSnapshot",
  );
  assert.equal(writeCommands[0], "replaceRange");
  assert.equal(writeCommands[1], "requestSnapshot");
  assert.equal(parseFrontmatter(peer.mirrorAtFirstSnapshot!).data.title, "Old");
  assert.ok(f.saved.some((save) => save.force));
  assert.ok(f.saved.length > 0);
  for (const save of f.saved) {
    assert.equal(parseFrontmatter(save.value).data.title, "Latest");
    assert.ok(save.value.endsWith("Keep this paragraph."));
  }
});

function saveButton(
  f: ReturnType<typeof fixture>,
  peer: ReturnType<typeof editorPeer>,
) {
  const root = peer.window.document.createElement("div");
  const button = peer.window.document.createElement("button");
  const icon = peer.window.document.createElement("span");
  button.setAttribute("data-action", "save");
  button.append(icon);
  root.append(button);
  peer.parent.append(root);
  f.bindToolbar(root as unknown as HTMLElement);
  return () =>
    icon.dispatchEvent(new peer.window.MouseEvent("click", { bubbles: true }));
}

test("the actual toolbar Save click flushes title before snapshot and persists exactly once", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Latest\n\nKeep this paragraph.";
  const f = fixture(value),
    peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  f.type(value);
  saveButton(f, peer)();
  assert.equal(f.requests.length, 1);
  await f.requests[0].promise;
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Latest");
  assert.ok(f.saved[0].value.endsWith("Keep this paragraph."));
  assert.equal(
    coordinator.dirty,
    false,
    "The echo revision belongs to the saved snapshot",
  );
  const commands = peer.commands.filter(
    (type) => type === "replaceRange" || type === "requestSnapshot",
  );
  assert.deepEqual(commands, ["replaceRange", "requestSnapshot"]);
  assert.equal(
    f.requests.length,
    1,
    "Title echo does not enqueue a second save",
  );
  f.clock.advance(1200);
  await f.requests.at(-1)!.promise;
  assert.equal(
    f.saved.length,
    1,
    "Remaining autosave does not rewrite a clean document",
  );
});

test("the registered document-sync flush saves latest title and retains force without an echo save", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Sync latest\n\nUnchanged paragraph.";
  const f = fixture(value),
    peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  f.type(value);
  await f.documentFlush();
  assert.equal(f.saved.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Sync latest");
  assert.equal(coordinator.dirty, false);
  assert.deepEqual(
    peer.commands.filter(
      (type) => type === "replaceRange" || type === "requestSnapshot",
    ),
    ["replaceRange", "requestSnapshot"],
  );
});

test("direct coordinator saves also prepare pending title before the exact snapshot", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Direct latest\n\nBody";
  const f = fixture(value),
    peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  f.type(value);
  await coordinator.request({ force: true, cleanupImages: true });
  assert.equal(f.saved.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Direct latest");
  assert.equal(coordinator.dirty, false);
  assert.deepEqual(
    peer.commands.filter(
      (type) => type === "replaceRange" || type === "requestSnapshot",
    ),
    ["replaceRange", "requestSnapshot"],
  );
});

test("a toolbar save failure retains dirty state and a forced retry saves the synchronized title", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Retry latest\n\nRecoverable body";
  const f = fixture(value),
    peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  f.type(value);
  f.failSave(new Error("synthetic write failure"));
  const click = saveButton(f, peer);
  click();
  await assert.rejects(f.requests[0].promise, /synthetic write failure/);
  assert.equal(coordinator.dirty, true);
  assert.equal(f.saved.length, 0);
  assert.ok(f.reportedErrors.length > 0);
  assert.equal(
    f.requests.length,
    1,
    "A failed owned save is not silently retried by its title echo",
  );
  f.clearFailure();
  click();
  await f.requests[1].promise;
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Retry latest");
  assert.equal(coordinator.dirty, false);
});

test("the real editor Save callback preserves force and persists the title echo only once", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Keyboard latest\n\nBody";
  const f = fixture(value),
    peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  f.type(value);
  f.explicitSave();
  // The keyboard route waits for the title replacement echo before requesting save.
  await Promise.resolve();
  assert.equal(f.requests.length, 1);
  await f.requests[0].promise;
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.equal(
    parseFrontmatter(f.saved[0].value).data.title,
    "Keyboard latest",
  );
  assert.equal(coordinator.dirty, false);
  assert.equal(
    peer.commands.filter((type) => type === "requestSnapshot").length,
    1,
  );
});

test("a title echo after snapshot timeout remains dirty and gets its own corrective save", async (context) => {
  const value = "---\ntitle: Old\n---\n\n# Late title\n\nRecoverable body";
  const f = fixture(value),
    peer = editorPeer(context, f, { holdMessages: true });
  const coordinator = f.useCoordinator();
  f.type(value);
  saveButton(f, peer)();
  await f.requests[0].promise; // The real bridge's 400ms timeout returns the mirrored body.
  assert.equal(f.saved.length, 1);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Old");
  peer.releaseMessages();
  assert.equal(
    f.requests.length,
    2,
    "A completed owner must not suppress its late title edit",
  );
  await f.requests[1].promise;
  assert.equal(f.saved.length, 2);
  assert.equal(parseFrontmatter(f.saved[1].value).data.title, "Late title");
  assert.equal(coordinator.dirty, false);
});

test("composition suspends already queued title/autosave work and resumes only after the committed change", () => {
  const f = fixture("---\ntitle: Before\n---\n\n# Before\n");
  f.type("---\ntitle: Before\n---\n\n# First edit\n");
  f.clock.advance(600);
  const statsBeforeComposition = f.statsReads;
  f.compose(true);
  f.type("---\ntitle: Before\n---\n\n# zhongwen\n");
  f.clock.advance(5000);
  assert.equal(
    f.marked,
    2,
    "candidate changes still mark the live buffer dirty",
  );
  assert.equal(f.titleScans, 0);
  assert.equal(f.replacements.length, 0);
  assert.equal(f.saved.length, 0);
  assert.equal(f.statsReads, statsBeforeComposition);
  f.type("---\ntitle: Before\n---\n\n# 中文\n");
  f.compose(false);
  f.clock.advance(799);
  assert.equal(f.statsReads, statsBeforeComposition + 1);
  assert.equal(f.saved.length, 0);
  assert.equal(f.replacements.length, 0);
  f.clock.advance(1);
  assert.equal(f.replacements.length, 1);
  f.echoReplacement();
  assert.equal(f.saved.length, 1);
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "中文");
  assert.equal(f.saved[0].force, false);
});

test("an explicit composition snapshot preserves force without rewriting title and final commit resumes autosave", async (context) => {
  const f = fixture("---\ntitle: Before\n---\n\n# Before\n");
  const peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  await peer.editor.ready;
  peer.compose(true);
  assert.equal(peer.editor.isComposing(), true);
  peer.change("---\ntitle: Before\n---\n\n# zhongwen\n");
  f.clock.advance(5000);
  assert.equal(f.requests.length, 0);
  f.explicitSave();
  await f.requests[0].promise;
  assert.equal(f.saved[0].force, true);
  assert.ok(f.saved[0].value.includes("# zhongwen"));
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Before");
  assert.equal(peer.commands.includes("replaceRange"), false);
  assert.equal(coordinator.dirty, false);

  peer.change("---\ntitle: Before\n---\n\n# 中文\n");
  peer.compose(false);
  assert.equal(peer.editor.isComposing(), false);
  f.clock.advance(400);
  peer.compose(false); // A duplicate message must not postpone the debounce.
  f.clock.advance(400);
  await Promise.resolve();
  assert.equal(f.requests.length, 2);
  await f.requests[1].promise;
  assert.equal(f.saved[1].force, false);
  assert.equal(parseFrontmatter(f.saved[1].value).data.title, "中文");
  assert.equal(coordinator.dirty, false);
});

test("document sync snapshots composition without waiting and a clean forced draft still repairs its pending title on end", async (context) => {
  const f = fixture("---\ntitle: Before\n---\n\n# Before\n");
  const peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  await peer.editor.ready;
  peer.compose(true);
  peer.change("---\ntitle: Before\n---\n\n# 已输入\n");
  await f.documentFlush();
  assert.equal(f.saved[0].force, true);
  assert.equal(peer.commands.includes("replaceRange"), false);
  assert.equal(coordinator.dirty, false);
  // Some input methods emit the last change before compositionend and have
  // no additional document transaction after the host's forced snapshot.
  peer.compose(false);
  f.clock.advance(1000);
  await Promise.resolve();
  await f.requests[1].promise;
  assert.equal(parseFrontmatter(f.saved[1].value).data.title, "已输入");
  assert.equal(coordinator.dirty, false);
});

test("close during composition saves the live draft without a title mutation or an indefinite composition wait", async (context) => {
  const f = fixture("---\ntitle: Before\n---\n\n# Before\n");
  const peer = editorPeer(context, f);
  f.useCoordinator();
  await peer.editor.ready;
  peer.compose(true);
  peer.change("---\ntitle: Before\n---\n\n# draft candidate\n");
  await f.close({ flush: true, throwOnSaveError: true });
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].force, true);
  assert.ok(f.saved[0].value.includes("# draft candidate"));
  assert.equal(parseFrontmatter(f.saved[0].value).data.title, "Before");
  assert.equal(peer.commands.includes("replaceRange"), false);
  assert.equal(peer.editor.isComposing(), false);
  peer.compose(true); // Teardown ignores delayed messages from the old frame.
  assert.equal(peer.editor.isComposing(), false);
  assert.equal(f.clock.pending.size, 0);
});

test("composition beginning during an in-flight autosave leaves newer candidate revisions dirty until confirmation", async (context) => {
  const f = fixture("# Committed\n");
  const peer = editorPeer(context, f);
  const coordinator = f.useCoordinator();
  await peer.editor.ready;
  peer.change("# Committed\n\nBefore composition.");
  const release = f.holdNextWrite();
  const saving = coordinator.request();
  for (let turn = 0; turn < 20 && !f.events.includes("persist"); turn++)
    await Promise.resolve();
  assert.ok(f.events.includes("persist"));
  peer.compose(true);
  peer.change("# Committed\n\nzhongwen");
  release();
  await saving;
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].value, "# Committed\n\nBefore composition.");
  assert.equal(coordinator.dirty, true);
  peer.change("# Committed\n\n中文");
  peer.compose(false);
  f.clock.advance(800);
  await f.requests.at(-1)!.promise;
  assert.equal(f.saved.at(-1)!.value, "# Committed\n\n中文");
  assert.equal(coordinator.dirty, false);
});

test("the sidebar's actual callbacks pause pending autosave during composition and preserve explicit save", async () => {
  const sidebarSource = ts.createSourceFile(
    "sidebar.ts",
    readFileSync(
      new URL("../src/modules/markdown/sidebar.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const controller = sidebarSource.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "SidebarController",
  )!;
  const methods = controller.members.filter(
    (node) =>
      ts.isMethodDeclaration(node) &&
      ["scheduleAutosave", "requestSave"].includes(
        node.name.getText(sidebarSource),
      ),
  );
  assert.equal(methods.length, 2);
  const callbacks = editorCallbacks(sidebarSource);
  const delay = sidebarSource.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (entry) => entry.name.getText(sidebarSource) === "AUTOSAVE_DELAY_MS",
      ),
  )!;
  const clock = fakeClock();
  let composing = false,
    dirty = false;
  const saves: boolean[] = [];
  const context = createContext({
    sourceID: "sidebar-ime",
    documentSyncRegistry: { markEdited() {} },
  });
  runInContext(
    ts.transpileModule(
      `
    ${delay.getText(sidebarSource)}
    class ActualSidebarScheduling {
      ${methods.map((node) => node.getText(sidebarSource)).join("\n")}
      callbacks() { return {
        onChange: ${callbacks.onChange.getText(sidebarSource)},
        onSave: ${callbacks.onSave.getText(sidebarSource)},
        onCompositionChange: ${callbacks.onCompositionChange.getText(sidebarSource)}
      }; }
    }
    globalThis.controller = new ActualSidebarScheduling();
  `,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    context,
  );
  const instance = context.controller;
  Object.assign(instance, {
    win: clock,
    editor: { isComposing: () => composing },
    save: {
      get dirty() {
        return dirty;
      },
      markChanged() {
        dirty = true;
      },
      async request({ force }: { force: boolean }) {
        saves.push(force);
        dirty = false;
      },
    },
  });
  const events = instance.callbacks();
  events.onChange();
  const queued = [...clock.pending.values()][0].run;
  clock.advance(1000);
  composing = true;
  events.onCompositionChange(true);
  events.onChange();
  queued(); // A timer already dequeued before the start message remains guarded.
  clock.advance(5000);
  assert.deepEqual(saves, []);
  events.onSave();
  assert.deepEqual(saves, [true]);
  events.onChange();
  composing = false;
  events.onCompositionChange(false);
  clock.advance(1499);
  assert.deepEqual(saves, [true]);
  clock.advance(1);
  assert.deepEqual(saves, [true, false]);
});
