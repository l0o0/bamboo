import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MORE_MENU_SECTIONS } from "../src/modules/markdown/more-menu.ts";

describe("more menu", () => {
  it("keeps document, editor, export, and other actions separated", () => {
    assert.equal(MORE_MENU_SECTIONS.length, 4);
    assert.deepEqual(
      MORE_MENU_SECTIONS.map((section) => section.map((item) => item.action)),
      [
        ["document-info", "rename", "show-in-folder"],
        ["find", "source", "mode"],
        ["export-pdf", "export-html"],
        ["import-external-images", "cleanup-images", "shortcuts", "settings"],
      ],
    );
  });
});
