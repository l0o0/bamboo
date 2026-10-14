import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  mountOutlineSidebar,
  outlineIndentPx,
  outlineItemNeedsReveal,
  outlineVisibleAtWidth,
  type OutlineSidebarHandle,
} from "../src/modules/markdown/outline-sidebar.ts";
import { iconPanelLeft } from "../src/modules/markdown/icons.ts";
import { outlineSidebarCSS } from "../src/modules/markdown/styles.ts";

test("caps indentation and auto-hides only at narrow widths", () => {
  assert.equal(outlineIndentPx(1), 8);
  assert.equal(outlineIndentPx(3), 32);
  assert.equal(outlineIndentPx(6), 44);
  assert.equal(outlineVisibleAtWidth(true, 900), true);
  assert.equal(outlineVisibleAtWidth(true, 620), false);
  assert.equal(outlineVisibleAtWidth(false, 900), false);
});

test("reveals only active items outside the outline viewport", () => {
  const viewport = { top: 100, bottom: 300 };
  assert.equal(
    outlineItemNeedsReveal({ top: 120, bottom: 150 }, viewport),
    false,
  );
  assert.equal(
    outlineItemNeedsReveal({ top: 80, bottom: 110 }, viewport),
    true,
  );
  assert.equal(
    outlineItemNeedsReveal({ top: 290, bottom: 320 }, viewport),
    true,
  );

  const source = readFileSync(
    "src/modules/markdown/outline-sidebar.ts",
    "utf8",
  );
  assert.match(source, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("defines unframed geometry and complete collapse", () => {
  const css = outlineSidebarCSS();

  assert.match(css, /inline-size: clamp\(200px, 18vw, 220px\)/);
  assert.match(css, /border-inline-end: 1px solid var\(--zmd-border\)/);
  assert.match(css, /is-outline-collapsed[\s\S]*display: none/);
  assert.match(css, /text-overflow: ellipsis/);
  assert.doesNotMatch(css, /zotero-markdown-outline-header/);
  assert.doesNotMatch(css, /zotero-markdown-outline-collapse/);
  assert.doesNotMatch(css, /box-shadow/);
});

test("uses the leading toolbar panel button as the only outline control", () => {
  const source = readFileSync("src/modules/markdown/tab.ts", "utf8");
  const toggleIndex = source.indexOf('"data-action": "outline-toggle"');
  const saveIndex = source.indexOf('"data-action": "save"');

  assert.ok(toggleIndex >= 0);
  assert.ok(saveIndex > toggleIndex);
  assert.match(source, /zotero-markdown-outline-sidebar/);
  assert.match(source, /onOutline:/);
  assert.match(source, /revealPosition/);
  assert.match(source, /session\.outlineActiveID = item\.id/);
  assert.match(source, /outlineSidebar\?\.setActive\(item\.id\)/);
  assert.doesNotMatch(source, /zotero-markdown-outline-header/);
  assert.doesNotMatch(source, /outlineCollapseEl/);
  assert.doesNotMatch(source, /iconPanelLeftClose/);
  assert.match(iconPanelLeft(), /chrome:\/\/bamboo\/content\/icons\/markdown/);
});

test("uses XHTML-safe markup for sidebar toolbar icons", () => {
  const icon = iconPanelLeft();

  assert.match(icon, /^<span\b[^>]*><\/span>$/);
  assert.match(icon, /--zmd-icon-url: url/);
  assert.doesNotMatch(icon, /<svg/);
  assert.doesNotMatch(icon, /<\/img>/);
});

function animatedOutline(t: TestContext) {
  const browser = new Window();
  const doc = browser.document;
  doc.body.innerHTML =
    '<main><button id="toggle"></button><nav><div id="list"></div></nav></main>';
  const root = doc.querySelector("main")!;
  const sidebar = doc.querySelector("nav")!;
  const list = doc.querySelector<HTMLDivElement>("#list")!;
  const toggle = doc.querySelector<HTMLButtonElement>("#toggle")!;
  let width = 900;
  root.getBoundingClientRect = () => ({ width }) as DOMRect;
  list.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
  for (const [name, value] of Object.entries({
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 220,
    offsetHeight: 600,
  }))
    Object.defineProperty(sidebar, name, { get: () => value });
  let resize = () => {};
  let disconnected = false;
  browser.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof browser.ResizeObserver;
  const animations: {
    finished: Promise<void>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    canceled: number;
    cancel(): void;
  }[] = [];
  sidebar.animate = (() => {
    let rejectFinished = (_error: Error) => {};
    const animation = {
      finished: new Promise<void>((_resolve, reject) => {
        rejectFinished = reject;
      }),
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      canceled: 0,
      cancel() {
        this.canceled++;
        rejectFinished(
          new browser.DOMException("Animation cancelled", "AbortError"),
        );
        this.oncancel?.();
      },
    };
    animations.push(animation);
    return animation;
  }) as unknown as typeof sidebar.animate;
  let expanded = true;
  const handle: OutlineSidebarHandle = mountOutlineSidebar({
    root: root as unknown as HTMLElement,
    sidebar: sidebar as unknown as HTMLElement,
    list: list as unknown as HTMLElement,
    toolbarToggle: toggle as unknown as HTMLButtonElement,
    emptyLabel: "No headings",
    getExpanded: () => expanded,
    onExpandedChange(next) {
      expanded = next;
      handle.setExpanded(next);
    },
    onNavigate() {},
  });
  handle.update(
    [{ id: "heading", level: 1, text: "Heading", from: 0 }],
    "heading",
  );
  const heading = list.querySelector("button")!;
  let reveals = 0;
  heading.scrollIntoView = () => {
    reveals++;
  };
  heading.getBoundingClientRect = () => ({ top: 50, bottom: 80 }) as DOMRect;
  handle.setActive("heading");
  t.after(() => {
    handle.destroy();
    browser.close();
  });
  return {
    browser,
    root,
    sidebar,
    toggle,
    heading,
    handle,
    animations,
    expanded: () => expanded,
    reveals: () => reveals,
    disconnected: () => disconnected,
    resize(nextWidth = width) {
      width = nextWidth;
      resize();
    },
  };
}

test("outline ignores repeated resize notifications and stale close completion after reopening", (t) => {
  const ui = animatedOutline(t);
  assert.equal(ui.animations.length, 0, "mount must not animate");
  ui.heading.focus();
  ui.toggle.click();
  assert.equal(ui.expanded(), false);
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(ui.sidebar.inert, true);
  assert.equal(ui.browser.document.activeElement, ui.toggle);
  assert.equal(ui.animations.length, 1);
  const oldClose = ui.animations[0].onfinish!;
  ui.resize();
  ui.resize();
  assert.equal(ui.animations.length, 1);
  assert.equal(
    ui.animations[0].canceled,
    0,
    "same-width RO keeps the running animation",
  );

  ui.toggle.click();
  assert.equal(ui.animations.length, 2);
  assert.equal(ui.animations[0].canceled, 1);
  oldClose();
  assert.equal(ui.expanded(), true);
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(ui.sidebar.inert, false);
  assert.equal(ui.root.classList.contains("is-outline-collapsed"), false);
  const reveals = ui.reveals();
  ui.resize();
  assert.equal(ui.animations[1].canceled, 0);
  ui.resize(901);
  assert.equal(
    ui.animations[1].canceled,
    1,
    "a real width change settles the animation",
  );
  assert.equal(ui.animations.length, 2);
  assert.equal(
    ui.reveals(),
    reveals,
    "RO must not scroll the active heading repeatedly",
  );
});

test("outline crosses the exact auto-hide boundary without changing the user's expanded choice", (t) => {
  const ui = animatedOutline(t);
  ui.heading.focus();
  ui.resize(679);
  assert.equal(ui.handle.isVisible(), false);
  assert.equal(
    ui.expanded(),
    true,
    "auto-hide keeps the user's expansion preference",
  );
  assert.equal(ui.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(ui.sidebar.inert, true);
  assert.equal(ui.browser.document.activeElement, ui.toggle);
  ui.resize(680);
  assert.equal(ui.handle.isVisible(), true);
  assert.equal(ui.sidebar.inert, false);
  assert.equal(ui.animations.length, 0, "breakpoint changes must not animate");

  ui.toggle.click();
  ui.resize(679);
  ui.resize(900);
  assert.equal(ui.handle.isVisible(), false);
  assert.equal(
    ui.expanded(),
    false,
    "widening must not reopen a manually collapsed panel",
  );
  ui.toggle.click();
  const opening = ui.animations.at(-1)!;
  ui.handle.destroy();
  assert.equal(opening.canceled, 1);
  assert.equal(ui.disconnected(), true);
  ui.toggle.click();
  assert.equal(
    ui.expanded(),
    true,
    "destroyed controls cannot change the stored choice",
  );
});
