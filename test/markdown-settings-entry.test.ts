import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const preferences = readFileSync(
  new URL("../addon/content/preferences.xhtml", import.meta.url),
  "utf8",
);

test("keeps the Zotero preference pane as a settings entry only", () => {
  assert.match(preferences, /zotero-markdown-open-settings/);
  assert.match(preferences, /pref-open-settings/);
  assert.doesNotMatch(preferences, /preference="enable"/);
  assert.doesNotMatch(preferences, /preference="frontmatter"/);
  assert.doesNotMatch(preferences, /preference="fontSize"/);
  assert.doesNotMatch(preferences, /preference="shortcutNewStandaloneMd"/);
});

test("binds the preference entry to the shared Markdown settings opener", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /openMarkdownSettings/);
  assert.match(source, /bindMarkdownSettingsPreferencePane/);
  assert.match(source, /zotero-markdown-open-settings/);
  assert.match(source, /markdownSettingsAbout/);
  assert.match(source, /about:\s*markdownSettingsAbout\(\)/);
});

test("passes the same about metadata to tab settings", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /about:\s*markdownSettingsAbout\(\)/);
});

function preferencePaneFixture() {
  const win = new Window();
  const mainWindow = new Window();
  win.document.body.innerHTML = preferences
    .replaceAll("html:", "")
    .replace(/\s+onload="[^"]*"/, "");
  let opens = 0;
  const launched: string[] = [];
  const exports: {
    bindMarkdownSettingsPreferencePane(doc: unknown): () => void;
  } = {} as any;
  const mocks: Record<string, unknown> = {
    "./editor": { resolveEditorTheme: () => "light" },
    "./modal": {
      createMarkdownModalController: () => ({
        open: () => opens++,
        destroy: () => {},
      }),
    },
    "./styles": { injectMarkdownStyles: () => {} },
  };
  const source = readFileSync(
    new URL("../src/modules/markdown/settings.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  });
  runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in mocks, `Unexpected import: ${name}`);
      return mocks[name];
    },
    addon: { data: { config: { addonName: "Scholar Sketch" } } },
    __buildVersion__: "0.2.6",
    __buildTime__: "test",
    Zotero: {
      getMainWindow: () => mainWindow,
      launchURL: (url: string) => launched.push(url),
    },
  });
  return {
    win,
    launched,
    opens: () => opens,
    bind: () => exports.bindMarkdownSettingsPreferencePane(win.document),
    button: win.document.getElementById("zotero-markdown-open-settings")!,
    github: win.document.getElementById("zotero-markdown-github")!,
    pane: win.document.getElementById("zotero-markdown-preferences")!,
  };
}

test("preference actions fire once after rebind and old cleanup is harmless", () => {
  const fixture = preferencePaneFixture();
  const oldCleanup = fixture.bind();
  const cleanup = fixture.bind();
  oldCleanup();
  fixture.button.click();
  assert.equal(fixture.opens(), 1);

  const click = new fixture.win.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  fixture.github.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(fixture.launched, [
    "https://github.com/l0o0/scholar-sketch",
  ]);

  cleanup();
  cleanup();
  fixture.button.click();
  fixture.github.click();
  assert.equal(fixture.opens(), 1);
  assert.equal(fixture.launched.length, 1);
});

test("preference actions detach when Zotero unloads the pane or window", () => {
  const fixture = preferencePaneFixture();
  fixture.bind();
  fixture.pane.dispatchEvent(new fixture.win.Event("unload"));
  fixture.button.click();
  fixture.github.click();
  assert.equal(fixture.opens(), 0);
  assert.equal(fixture.launched.length, 0);

  fixture.bind();
  fixture.button.click();
  assert.equal(fixture.opens(), 1);
  fixture.win.dispatchEvent(new fixture.win.Event("unload"));
  fixture.button.click();
  fixture.github.click();
  assert.equal(fixture.opens(), 1);
  assert.equal(fixture.launched.length, 0);
});
