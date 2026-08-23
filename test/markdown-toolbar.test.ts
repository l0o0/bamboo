import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  imageInsertTemplate,
  tableInsertTemplate,
} from "../src/modules/markdown/insert-template.ts";
import { iconH3 } from "../src/modules/markdown/icons.ts";
import { modeToggleState } from "../src/modules/markdown/tab.ts";
import {
  responsiveToolbarSizingCSS,
  toolbarWidthAlignmentCSS,
} from "../src/modules/markdown/styles.ts";

describe("toolbar insert templates", () => {
  it("inserts a default 3 by 3 editable table template", () => {
    assert.deepEqual(tableInsertTemplate(), {
      text:
        "| Column 1 | Column 2 | Column 3 |\n" +
        "| --- | --- | --- |\n" +
        "| Cell | Cell | Cell |\n" +
        "| Cell | Cell | Cell |",
      selectionFrom: 2,
      selectionTo: 10,
    });
  });

  it("builds a table from picker dimensions", () => {
    assert.deepEqual(tableInsertTemplate(2, 4), {
      text:
        "| Column 1 | Column 2 | Column 3 | Column 4 |\n" +
        "| --- | --- | --- | --- |\n" +
        "| Cell | Cell | Cell | Cell |",
      selectionFrom: 2,
      selectionTo: 10,
    });
  });

  it("allows a one-row table without adding an unwanted body row", () => {
    assert.equal(
      tableInsertTemplate(1, 2).text,
      "| Column 1 | Column 2 |\n| --- | --- |",
    );
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
    assert.match(icon, /M17\.5 10\.5/);
    assert.match(icon, /M17 17\.5/);
    assert.doesNotMatch(icon, /M21 12c0-1\.5/);
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
    assert.match(live.icon, /m18 16 4-4-4-4/);
    assert.match(live.label, /Source Code/);

    const source = modeToggleState("source");
    assert.equal(source.target, "live");
    assert.match(source.icon, /M12 20h9/);
    assert.match(source.label, /Live/);

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
