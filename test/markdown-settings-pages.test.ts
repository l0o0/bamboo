import assert from "node:assert/strict";
import test from "node:test";
import {
  nextSettingsPage,
  SETTINGS_PAGES,
  settingsPageLabelKey,
} from "../src/modules/markdown/settings-pages.ts";

test("defines the four settings pages in a stable order", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map(({ id, icon }) => [id, icon]),
    [
      ["general", "settings"],
      ["editor", "type"],
      ["shortcuts", "keyboard"],
      ["about", "info"],
    ],
  );
});

test("maps every settings page to a localized label key", () => {
  for (const { id } of SETTINGS_PAGES) {
    assert.equal(settingsPageLabelKey(id), `settings-page-${id}`);
  }
});

test("wraps keyboard navigation across settings pages", () => {
  assert.equal(nextSettingsPage("general", 1), "editor");
  assert.equal(nextSettingsPage("general", -1), "about");
  assert.equal(nextSettingsPage("about", 1), "general");
});
