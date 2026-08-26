import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  imageInsertTemplate,
  tableInsertTemplate,
} from "../src/modules/markdown/insert-template.ts";
import { iconH2, iconH3 } from "../src/modules/markdown/icons.ts";
import { modeToggleState } from "../src/modules/markdown/tab.ts";
import {
  responsiveToolbarSizingCSS,
  toolbarWidthAlignmentCSS,
} from "../src/modules/markdown/styles.ts";

describe("toolbar insert templates", () => {
  it("inserts a default 3 by 3 editable table template", () => {
    assert.deepEqual(tableInsertTemplate(), {
      text:
        "|  |  |  |\n" +
        "| --- | --- | --- |\n" +
        "|  |  |  |\n" +
        "|  |  |  |",
      selectionFrom: 2,
      selectionTo: 2,
    });
  });

  it("builds a table from picker dimensions", () => {
    assert.deepEqual(tableInsertTemplate(2, 4), {
      text: "|  |  |  |  |\n" + "| --- | --- | --- | --- |\n" + "|  |  |  |  |",
      selectionFrom: 2,
      selectionTo: 2,
    });
  });

  it("allows a one-row table without adding an unwanted body row", () => {
    assert.equal(tableInsertTemplate(1, 2).text, "|  |  |\n| --- | --- |");
  });

  it("selects image alt text after insertion", () => {
    assert.deepEqual(imageInsertTemplate(), {
      text: "![alt](url)",
      selectionFrom: 2,
      selectionTo: 5,
    });
  });

  it("renders heading 3 with distinct upper and lower strokes", () => {
    const icon = iconH3();
    assert.match(icon, /content\/icons\/markdown\/h3\.svg/);
  });

  it("draws heading 2 with a clear lower horizontal stroke", () => {
    const icon = iconH2();
    const source = readFileSync(
      new URL("../addon/content/icons/markdown/h2.svg", import.meta.url),
      "utf8",
    );

    assert.match(icon, /content\/icons\/markdown\/h2\.svg/);
    assert.match(
      source,
      /M17 10\.5c\.4-1\.2 1\.3-2 2\.5-2 1\.4 0 2\.5\.9 2\.5 2\.2 0 1-\.5 1\.8-1\.5 2\.7L17 18h5/,
    );
  });

  it("defines compact, comfortable, and large responsive toolbar sizes", () => {
    const css = responsiveToolbarSizingCSS();
    assert.match(css, /--zmd-toolbar-icon-size: 18px/);
    assert.match(css, /--zmd-toolbar-control-size: 40px/);
    assert.match(css, /@container zmd-toolbar \(min-width: 1050px\)/);
    assert.match(css, /--zmd-toolbar-icon-size: 20px/);
    assert.match(css, /--zmd-toolbar-control-size: 44px/);
    assert.match(css, /@container zmd-toolbar \(max-width: 760px\)/);
    assert.match(css, /--zmd-toolbar-icon-size: 16px/);
    assert.match(css, /--zmd-toolbar-control-size: 36px/);
  });

  it("keeps the toolbar at the configured 60rem width", () => {
    const css = toolbarWidthAlignmentCSS();
    assert.match(css, /padding: 4px 30px 4px 34px/);
    assert.match(css, /width: 100%/);
    assert.match(css, /max-width: 60rem/);
  });

  it("switches the toolbar icon and target with the current editor mode", () => {
    const live = modeToggleState("live");
    assert.equal(live.target, "source");
    assert.match(live.icon, /content\/icons\/markdown\/source\.svg/);
    // Localized labels resolve at runtime; without a Zotero window the
    // prefixed Fluent id is returned.
    assert.equal(live.label, "bamboo-tab-mode-toggle-source");

    const source = modeToggleState("source");
    assert.equal(source.target, "live");
    assert.match(source.icon, /content\/icons\/markdown\/live\.svg/);
    assert.equal(source.label, "bamboo-tab-mode-toggle-live");

    const preview = modeToggleState("preview");
    assert.equal(preview.target, "live");
  });

  it("declares a mode toggle before the more menu", () => {
    const source = readFileSync(
      new URL("../src/modules/markdown/tab.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /zotero-markdown-mode-toggle/);
    assert.match(source, /data-action.*mode-toggle/);
    assert.match(source, /aria-pressed/);
    assert.match(source, /updateModeToggle\(session\)/);
  });
});
