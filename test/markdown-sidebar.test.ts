import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  canReuseSidebarEditor,
  planSidebarVisibility,
  sidebarFocusAction,
  SidebarControllerRegistry,
  shouldMountSidebarUI,
  shouldUseSidebarFocusMode,
} from "../src/modules/markdown/sidebar-state.ts";
import { sidebarEditorGeometryCSS } from "../src/modules/markdown/styles.ts";

describe("Markdown sidebar state", () => {
  it("uses Fluent attributes so localization preserves the section body", () => {
    for (const locale of ["en-US", "zh-CN"]) {
      const source = readFileSync(
        new URL(`../addon/locale/${locale}/mainWindow.ftl`, import.meta.url),
        "utf8",
      );
      assert.match(
        source,
        /^sidebar-section-label\s*=\s*\n\s+\.label\s*=\s*Markdown\s*$/m,
      );
      assert.match(
        source,
        /^sidebar-section-tooltip\s*=\s*\n\s+\.tooltiptext\s*=\s*.+$/m,
      );
    }
  });

  it("keeps a parent attachment list beside the editor", () => {
    assert.deepEqual(planSidebarVisibility("editor", true), {
      list: true,
      editor: true,
      hint: false,
      empty: false,
    });
  });

  it("shows only the editor for a directly selected attachment", () => {
    assert.deepEqual(planSidebarVisibility("editor", false), {
      list: false,
      editor: true,
      hint: false,
      empty: false,
    });
  });

  it("preserves a parent attachment list beside a tab-conflict hint", () => {
    assert.deepEqual(planSidebarVisibility("hint", true), {
      list: true,
      editor: false,
      hint: true,
      empty: false,
    });
  });

  it("shows only the empty state", () => {
    assert.deepEqual(planSidebarVisibility("empty", true), {
      list: false,
      editor: false,
      hint: false,
      empty: true,
    });
  });

  it("reuses only the editor for the same attachment", () => {
    assert.equal(canReuseSidebarEditor(true, 42, 42), true);
    assert.equal(canReuseSidebarEditor(true, 42, 43), false);
    assert.equal(canReuseSidebarEditor(false, 42, 42), false);
  });

  it("mounts the editor only during Zotero's render lifecycle", () => {
    assert.equal(shouldMountSidebarUI("init"), false);
    assert.equal(shouldMountSidebarUI("itemChange"), false);
    assert.equal(shouldMountSidebarUI("toggle"), false);
    assert.equal(shouldMountSidebarUI("render"), true);
  });

  it("uses fixed focus mode only for a directly selected Markdown attachment", () => {
    assert.equal(shouldUseSidebarFocusMode(true), true);
    assert.equal(shouldUseSidebarFocusMode(false), false);
  });

  it("releases focus for other sidenav panes and restores it for Markdown", () => {
    const markdownPaneID = "zotero-markdown@l0o0.github.io-zmd-markdown";
    assert.equal(sidebarFocusAction("info", markdownPaneID), "release");
    assert.equal(sidebarFocusAction("attachments", markdownPaneID), "release");
    assert.equal(sidebarFocusAction(markdownPaneID, markdownPaneID), "focus");
    assert.equal(sidebarFocusAction(null, markdownPaneID), "ignore");
  });

  it("isolates controllers for multiple sections in the same window", () => {
    const registry = new SidebarControllerRegistry<
      object,
      object,
      { id: string }
    >();
    const win = {};
    const oldBody = {};
    const currentBody = {};
    const oldController = { id: "old" };
    const currentController = { id: "current" };

    registry.bind(win, oldBody, oldController);
    registry.bind(win, currentBody, currentController);

    assert.equal(registry.release(win, oldBody), oldController);
    assert.equal(registry.get(currentBody), currentController);
    assert.deepEqual(registry.releaseWindow(win), [currentController]);
  });

  it("lets the focused item-pane editor fill the available height", () => {
    const css = sidebarEditorGeometryCSS();
    assert.match(css, /height: auto/);
    assert.match(css, /\.zmd-sidebar-focus-mode/);
    assert.match(css, /overflow:\s*hidden/);
    assert.match(css, /block-size:\s*100%/);
    assert.match(css, /flex:\s*1 1 auto/);
    assert.doesNotMatch(css, /clamp\(320px, 50vh, 600px\)/);
  });

  it("removes the native section chrome in focused Markdown mode", () => {
    const css = sidebarEditorGeometryCSS();
    assert.match(
      css,
      /\.zmd-sidebar-focus-section(?:\s*>\s*|\s+)collapsible-section\s*>\s*\.head[^{]*\{[^}]*display:\s*none/s,
    );
    assert.match(
      css,
      /\.zmd-sidebar-focus-section\s+\.zmd-sidebar\s*\{[^}]*padding:\s*0/s,
    );
    assert.match(
      css,
      /\.zmd-sidebar-focus-section\s+\.zmd-sidebar-editor-host\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0/s,
    );
    assert.match(
      css,
      /\.zmd-sidebar-focus-shell\s*>\s*#zotero-item-pane-header\s*\{[^}]*display:\s*none/s,
    );
    assert.match(
      css,
      /\.zmd-sidebar-focus-section\s*>\s*collapsible-section\s*\{[^}]*padding:\s*0\s*!important/s,
    );
  });

  it("adds a compact focus toolbar with common Markdown actions", () => {
    const source = readFileSync(
      new URL("../src/modules/markdown/sidebar.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /zmd-sidebar-toolbar/);
    for (const action of [
      "open-tab",
      "bold",
      "italic",
      "h1",
      "list",
      "link",
      "more",
    ]) {
      assert.match(
        source,
        new RegExp(`data-action["']?,?\\s*${action}|${action}`),
      );
    }
    assert.match(source, /wrapSelection\("\*\*"\)/);
    assert.match(source, /wrapSelection\("\*"\)/);
    assert.match(source, /prefixLine\("# "\)/);
    assert.match(source, /prefixLine\("- "\)/);
    assert.match(source, /wrapSelection\("\[",\s*"\]\(url\)"\)/);
    assert.doesNotMatch(source, /this\.btnMode/);
    assert.match(source, /surface:\s*"sidebar"/);
  });

  it("keeps the sidebar toolbar in one compact row", () => {
    const css = sidebarEditorGeometryCSS();
    assert.match(
      css,
      /\.zmd-sidebar-toolbar\s*\{[^}]*display:\s*flex[^}]*block-size:\s*41px[^}]*min-block-size:\s*41px[^}]*padding:\s*2px 8px[^}]*border-bottom:\s*var\(--material-panedivider\)[^}]*background:\s*var\(--material-toolbar\)/s,
    );
    assert.match(css, /\.zmd-sidebar-toolbar-spacer\s*\{[^}]*flex:\s*1/s);
    assert.match(
      css,
      /\.zmd-sidebar-toolbar-button\s*\{[^}]*flex:\s*0 0 35px[^}]*width:\s*35px[^}]*height:\s*35px[^}]*min-height:\s*35px[^}]*max-height:\s*35px[^}]*margin:\s*0/s,
    );
  });

  it("accepts Zotero XUL custom sections as focus-mode hosts", () => {
    const source = readFileSync(
      new URL("../src/modules/markdown/sidebar.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /sectionCandidate instanceof HTMLElement/);
    assert.match(source, /sectionCandidate instanceof this\.win\.Element/);
  });

  it("handles sidenav switching before Zotero scrolls to the target pane", () => {
    const source = readFileSync(
      new URL("../src/modules/markdown/sidebar.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /addEventListener\("click",\s*this\.handleSidenavClick,\s*true\)/,
    );
    assert.match(
      source,
      /this\.focusSidenav\?\.removeEventListener\(\s*"click",\s*this\.handleSidenavClick,\s*true,?\s*\)/,
    );
  });
});
