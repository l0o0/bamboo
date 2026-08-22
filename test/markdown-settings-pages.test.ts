import assert from "node:assert/strict";
import test from "node:test";
import {
  nextSettingsPage,
  SETTINGS_PAGES,
} from "../src/modules/markdown/settings-pages.ts";

test("defines the four settings pages in a stable order", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map(({ id, label }) => [id, label]),
    [
      ["general", "常规"],
      ["editor", "编辑器"],
      ["shortcuts", "快捷键"],
      ["about", "关于"],
    ],
  );
});

test("wraps keyboard navigation across settings pages", () => {
  assert.equal(nextSettingsPage("general", 1), "editor");
  assert.equal(nextSettingsPage("general", -1), "about");
  assert.equal(nextSettingsPage("about", 1), "general");
});
