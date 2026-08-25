# Bamboo Identity And Release Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bamboo the sole plugin, runtime API, repository, preference, and release artifact identity while retaining Markdown-specific CSS, DOM, and editor protocol names.

**Architecture:** Treat the rename as one clean identity boundary driven by `package.json`. Runtime registration reads `addonInstance=Bamboo`; scaffold build and GitHub Actions derive the versioned XPI name from the package version; documentation exposes only `Zotero.Bamboo`. No legacy alias or preference migration is included.

**Tech Stack:** TypeScript, Zotero Plugin Scaffold, Fluent localization, Node test runner via `tsx`, pnpm, GitHub Actions.

## Global Constraints

- Package name: `bamboo`.
- Display name: `Bamboo 竹子`.
- Add-on ID: `bamboo@l0o0.github.io`.
- Add-on reference / chrome namespace: `bamboo`.
- Zotero runtime instance and public API root: `Bamboo` / `Zotero.Bamboo`.
- Preference prefix: `extensions.zotero.bamboo`.
- GitHub repository: `https://github.com/l0o0/bamboo`.
- XPI filename and Actions artifact: `bamboo-v{version}.xpi`.
- Do not preserve `Zotero.ZoteroMarkdown` or migrate old preferences.
- Retain `.zotero-markdown-*` CSS classes, Markdown DOM IDs, `zotero-markdown-editor`, and Markdown module names.
- Preserve unrelated changes already present in the dirty worktree; do not create mixed implementation commits.

---

### Task 1: Canonical Plugin And Runtime Identity

**Files:**

- Create: `test/bamboo-branding.test.ts`
- Modify: `package.json`
- Modify: `src/index.ts`
- Modify: `src/hooks.ts`
- Modify: `src/utils/locale.ts`
- Modify: `src/modules/markdown/api.ts`

**Interfaces:**

- Consumes: `package.json.config` and the scaffold-provided `_globalThis.addon` sandbox global.
- Produces: a single runtime instance at `Zotero.Bamboo`, localization lookup through that instance, and package metadata using the Bamboo identity.

- [ ] **Step 1: Write the failing identity test**

Create `test/bamboo-branding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the identity test and verify RED**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts
```

Expected: FAIL because `addonID`, `addonInstance`, `prefsPrefix`, repository URLs, and legacy namespace references still use the old identity.

- [ ] **Step 3: Replace package identity metadata**

Set `package.json.config` and repository metadata to:

```json
{
  "config": {
    "addonName": "Bamboo 竹子",
    "addonID": "bamboo@l0o0.github.io",
    "addonRef": "bamboo",
    "addonInstance": "Bamboo",
    "prefsPrefix": "extensions.zotero.bamboo"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/l0o0/bamboo.git"
  },
  "bugs": {
    "url": "https://github.com/l0o0/bamboo/issues"
  },
  "homepage": "https://github.com/l0o0/bamboo#readme"
}
```

Append `test/bamboo-branding.test.ts` to the existing `test:unit` command without removing any current test files.

- [ ] **Step 4: Remove the runtime compatibility alias**

Keep `src/index.ts` config-driven and reduce its post-registration logic to:

```ts
if (!zoteroGlobal[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);
  zoteroGlobal[config.addonInstance] = addon;
}

_globalThis.addon = zoteroGlobal[config.addonInstance];
```

In `src/hooks.ts`, remove the explicit compatibility-alias deletion and keep only:

```ts
// @ts-expect-error - Plugin instance is not typed
delete Zotero[addon.data.config.addonInstance];
```

In `src/utils/locale.ts`, resolve the locale owner from the sandbox global or the configured instance only:

```ts
const addonRef =
  (globalThis as { addon?: unknown }).addon ||
  (typeof Zotero !== "undefined"
    ? (Zotero as unknown as Record<string, unknown>)[config.addonInstance]
    : undefined);
```

Update the API comment in `src/modules/markdown/api.ts` to name
`Zotero.Bamboo.api.markdown`.

- [ ] **Step 5: Run the identity test and verify GREEN**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts
```

Expected: PASS for both identity tests.

- [ ] **Step 6: Run focused type and formatting checks**

Run:

```bash
pnpm exec prettier --write package.json src/index.ts src/hooks.ts src/utils/locale.ts src/modules/markdown/api.ts test/bamboo-branding.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint src/index.ts src/hooks.ts src/utils/locale.ts src/modules/markdown/api.ts test/bamboo-branding.test.ts
```

Expected: all commands exit 0.

---

### Task 2: Versioned XPI And GitHub Actions Artifact

**Files:**

- Modify: `test/bamboo-branding.test.ts`
- Modify: `zotero-plugin.config.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `test/release-config.test.ts`

**Interfaces:**

- Consumes: `pkg.version` from `package.json` and GitHub Actions step output `steps.package.outputs.version`.
- Produces: `.scaffold/build/bamboo-v${pkg.version}.xpi`, matching update metadata, release upload, and Actions artifact naming.

- [ ] **Step 1: Add failing release naming tests**

Append to `test/bamboo-branding.test.ts`:

```ts
test("uses a versioned Bamboo XPI name in build and CI", async () => {
  const scaffold = await read("zotero-plugin.config.ts");
  const workflow = await read(".github/workflows/release.yml");
  assert.match(scaffold, /xpiName:\s*`bamboo-v\$\{pkg\.version\}`/);
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
});
```

Extend `test/release-config.test.ts` with:

```ts
test("release download uses the configured versioned XPI name", async () => {
  const config = await readFile("zotero-plugin.config.ts", "utf8");
  assert.match(config, /xpiName:\s*`bamboo-v\$\{pkg\.version\}`/);
  assert.match(config, /\{\{xpiName\}\}\.xpi/);
});
```

- [ ] **Step 2: Run release naming tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts test/release-config.test.ts
```

Expected: FAIL because `xpiName` is unset and the workflow artifact still uses `zotero-markdown-xpi`.

- [ ] **Step 3: Configure the versioned scaffold output**

Add this top-level property to `defineConfig` in `zotero-plugin.config.ts`:

```ts
xpiName: `bamboo-v${pkg.version}`,
```

Keep the release download template as:

```ts
xpiDownloadLink:
  "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",
```

- [ ] **Step 4: Make the workflow artifact use the package version**

After the Node setup step in `.github/workflows/release.yml`, add:

```yaml
- name: Resolve package version
  id: package
  run: echo "version=$(node -p \"require('./package.json').version\")" >> "$GITHUB_OUTPUT"
```

Change the upload step to:

```yaml
- name: Upload build artifact
  uses: actions/upload-artifact@v7
  with:
    name: bamboo-v${{ steps.package.outputs.version }}.xpi
    path: .scaffold/build/bamboo-v${{ steps.package.outputs.version }}.xpi
    if-no-files-found: error
```

- [ ] **Step 5: Run release naming tests and verify GREEN**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts test/release-config.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Build and verify the exact XPI filename**

Run:

```bash
NODE_ENV=production pnpm exec zotero-plugin build
test -s ".scaffold/build/bamboo-v$(node -p "require('./package.json').version").xpi"
```

Expected: both commands exit 0 and the XPI file is non-empty. If a running development watcher rewrites `.scaffold/build`, stop that watcher before repeating this isolated production-build check.

---

### Task 3: README, Current Documentation, And Repository Remote

**Files:**

- Modify: `test/bamboo-branding.test.ts`
- Modify: `README.md`
- Modify: `doc/README-zhCN.md`
- Modify: `docs/architecture.md`
- Modify: `docs/editor/codemirror-iframe-plan.md`
- Local Git configuration: `origin` remote URL

**Interfaces:**

- Consumes: canonical identity and XPI naming from Tasks 1 and 2.
- Produces: user documentation that links to `l0o0/bamboo`, documents `Zotero.Bamboo`, and describes current `chrome://bamboo` build paths.

- [ ] **Step 1: Add failing documentation tests**

Append to `test/bamboo-branding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run documentation tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts
```

Expected: FAIL on old GitHub URLs, `Zotero.ZoteroMarkdown`, and old chrome/script paths.

- [ ] **Step 3: Update English and Chinese README files**

In both README files:

- Replace `https://github.com/l0o0/zotero-markdown` with
  `https://github.com/l0o0/bamboo`.
- Replace `Zotero.ZoteroMarkdown.api.markdown` with
  `Zotero.Bamboo.api.markdown`.
- Replace `Zotero.ZoteroMarkdown.api.version` with
  `Zotero.Bamboo.api.version`.
- Remove compatibility wording about the `ZoteroMarkdown` namespace.
- State that release files use `bamboo-v{version}.xpi`.

- [ ] **Step 4: Update current architecture paths**

In `docs/architecture.md`, change the current product description to:

```md
Bamboo is a Zotero chrome plugin with a `chrome://bamboo` CodeMirror iframe.
The document authority is always the iframe editor; Zotero-side code owns
sessions, files, and chrome UI.
```

In `docs/editor/codemirror-iframe-plan.md`, replace current resource examples:

```text
chrome://zoteromarkdown/content/editor/index.html
content/scripts/zoteromarkdown.js
```

with:

```text
chrome://bamboo/content/editor/index.html
content/scripts/bamboo.js
```

Do not rename `zotero-markdown-editor` protocol examples or
`.zotero-markdown-*` UI selectors.

- [ ] **Step 5: Run documentation tests and verify GREEN**

Run:

```bash
pnpm exec tsx --test test/bamboo-branding.test.ts
```

Expected: all branding tests pass.

- [ ] **Step 6: Update and verify the local Git remote**

Run:

```bash
git remote set-url origin git@github.com:l0o0/bamboo.git
git remote get-url origin
```

Expected output:

```text
git@github.com:l0o0/bamboo.git
```

---

### Task 4: Full Verification And Naming Audit

**Files:**

- Verify all files modified in Tasks 1-3.

**Interfaces:**

- Consumes: the completed Bamboo identity, release, and documentation changes.
- Produces: evidence that the clean rename builds, tests, and packages correctly without altering retained Markdown identifiers.

- [ ] **Step 1: Format and lint all changes**

Run:

```bash
pnpm exec prettier --write package.json zotero-plugin.config.ts .github/workflows/release.yml README.md doc/README-zhCN.md docs/architecture.md docs/editor/codemirror-iframe-plan.md src/index.ts src/hooks.ts src/utils/locale.ts src/modules/markdown/api.ts test/bamboo-branding.test.ts test/release-config.test.ts
pnpm lint:check
```

Expected: Prettier reports no remaining differences and lint exits 0.

- [ ] **Step 2: Run the full unit suite**

Run:

```bash
pnpm test:unit
```

Expected: all unit tests pass with zero failures.

- [ ] **Step 3: Run the production build and type check**

Run:

```bash
NODE_ENV=production pnpm build
```

Expected: scaffold build and `tsc --noEmit` both exit 0.

- [ ] **Step 4: Verify output names and generated metadata**

Run:

```bash
VERSION=$(node -p "require('./package.json').version")
test -s ".scaffold/build/bamboo-v${VERSION}.xpi"
rg -n "github.com/l0o0/bamboo|bamboo-v${VERSION}\.xpi" .scaffold/build/update*.json
```

Expected: the XPI exists and update metadata contains the Bamboo repository and exact versioned filename.

- [ ] **Step 5: Audit remaining old names by category**

Run:

```bash
git grep -n -E 'Zotero\.ZoteroMarkdown|github\.com/l0o0/zotero-markdown|chrome://zoteromarkdown|content/scripts/zoteromarkdown\.js' -- ':!docs/reviews/**' ':!docs/superpowers/plans/**' ':!docs/superpowers/specs/**'
git grep -n -E 'zotero-markdown-(editor|open-settings)|\.zotero-markdown-' -- src addon
```

Expected: the first command returns no active identity references. The second command returns retained Markdown feature selectors and protocol identifiers.

- [ ] **Step 6: Inspect the scoped diff without committing unrelated work**

Run:

```bash
git diff --check
git diff -- package.json zotero-plugin.config.ts .github/workflows/release.yml README.md doc/README-zhCN.md docs/architecture.md docs/editor/codemirror-iframe-plan.md src/index.ts src/hooks.ts src/utils/locale.ts src/modules/markdown/api.ts test/bamboo-branding.test.ts test/release-config.test.ts
```

Expected: no whitespace errors; the diff contains only the approved identity, documentation, release, and test changes plus pre-existing edits already present in overlapping files.
