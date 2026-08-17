import assert from "node:assert/strict";
import test from "node:test";
import {
  liveEditorGeometry,
  livePreviewGeometryStyles,
} from "../src/editor/theme.ts";
import { THEME_TOKENS } from "../src/modules/markdown/theme-tokens.ts";

test("live editor puts horizontal spacing on lines for aligned selections", () => {
  assert.deepEqual(liveEditorGeometry(), {
    contentPadding: "4px 0 8px",
    linePadding: "0 30px 0 34px",
    tableMargin: "0 30px 0 34px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    tableCellMinHeight: "1.7em",
  });
});

test("sidebar live editor uses a narrower safe left inset", () => {
  assert.deepEqual(liveEditorGeometry("sidebar"), {
    contentPadding: "4px 0 8px",
    linePadding: "0 30px 0 20px",
    tableMargin: "0 30px 0 20px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    tableCellMinHeight: "1.7em",
  });
  assert.deepEqual(livePreviewGeometryStyles("sidebar"), {
    tableMargin: "0 30px 0 20px",
    tablePadding: "0",
    tableEdgeSize: "30px",
    codeBlockBackgroundClip: "content-box",
  });
});

test("shell and iframe share the same theme tokens", () => {
  assert.equal(THEME_TOKENS.light.text, "#111827");
  assert.equal(THEME_TOKENS.dark.surface, "#1a1d24");
  assert.equal(THEME_TOKENS.light.accent, "#2563eb");
  assert.equal(THEME_TOKENS.dark.accent, "#60a5fa");
});

test("themes define distinct syntax tokens", () => {
  assert.equal(THEME_TOKENS.light.codeKeyword, "#7c3aed");
  assert.equal(THEME_TOKENS.dark.codeKeyword, "#c084fc");
  assert.equal(THEME_TOKENS.light.codeString, "#047857");
  assert.equal(THEME_TOKENS.dark.codeString, "#86efac");
  assert.notEqual(THEME_TOKENS.light.codeComment, THEME_TOKENS.light.text);
  assert.notEqual(THEME_TOKENS.dark.codeComment, THEME_TOKENS.dark.text);
});
