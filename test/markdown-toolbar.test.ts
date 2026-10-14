import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Window } from "happy-dom";
import {
  imageInsertTemplate,
  tableInsertTemplate,
} from "../src/modules/markdown/insert-template.ts";
import { iconH2, iconH3 } from "../src/modules/markdown/icons.ts";
import * as icons from "../src/modules/markdown/icons.ts";
import { modeToggleState } from "../src/modules/markdown/tab.ts";
import {
  responsiveToolbarSizingCSS,
  toolbarWidthAlignmentCSS,
  injectMarkdownStyles,
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

  it("uses the shared toolbar density at every window width", () => {
    const css = responsiveToolbarSizingCSS();
    assert.match(css, /--zmd-toolbar-icon-size: 16px/);
    assert.match(css, /--zmd-toolbar-control-size: 32px/);
    assert.doesNotMatch(css, /44px|40px/);
    assert.match(css, /flex-wrap: nowrap/);
    assert.doesNotMatch(css, /flex-wrap: wrap|display: contents/);
    assert.match(css, /data-toolbar-layout="compact"/);
    assert.doesNotMatch(css, /order:|flex-basis: 100%/);
  });

  it("renders a compact floating toolbar bounded by the editor width", () => {
    const css = toolbarWidthAlignmentCSS();
    assert.match(css, /padding: 12px/);
    assert.match(css, /width: max-content/);
    assert.match(css, /max-width: 100%/);
    assert.match(css, /border-radius: 12px/);
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

  it("keeps the actual toolbar's trailing controls together and icon-only in all modes and sidebar states", async () => {
    const source = ts.createSourceFile(
      "tab.ts",
      readFileSync(
        new URL("../src/modules/markdown/tab.ts", import.meta.url),
        "utf8",
      ),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let toolbar: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(source) === "classList" &&
            ts.isArrayLiteralExpression(property.initializer) &&
            property.initializer.elements.some(
              (value) =>
                ts.isStringLiteral(value) &&
                value.text === "zotero-markdown-toolbar",
            ),
        )
      )
        toolbar = node;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(toolbar);
    type ElementSpec = {
      tag: string;
      classList?: string[];
      properties?: Record<string, string>;
      attributes?: Record<string, string>;
      children?: ElementSpec[];
    };
    const window = new Window();
    const previousAddon = Object.getOwnPropertyDescriptor(globalThis, "addon");
    Object.defineProperty(globalThis, "addon", {
      configurable: true,
      value: { data: { config: { addonRef: "bamboo" } } },
    });
    const render = (spec: ElementSpec) => {
      const element = window.document.createElement(spec.tag);
      if (spec.classList) element.classList.add(...spec.classList);
      Object.assign(element, spec.properties);
      for (const [key, value] of Object.entries(spec.attributes ?? {}))
        element.setAttribute(key, value);
      for (const child of spec.children ?? []) element.append(render(child));
      return element;
    };
    try {
      injectMarkdownStyles(window as unknown as globalThis.Window);
      for (const label of [
        "右侧边栏",
        "显示与当前文档相关的所有引用和反向链接侧边栏",
      ]) {
        const spec = runInNewContext(`(${toolbar.getText(source)})`, {
          ...icons,
          getString: () => label,
        }) as ElementSpec;
        const root = window.document.createElement("main");
        root.append(render(spec));
        window.document.body.append(root);
        const inner = root.querySelector(".zotero-markdown-toolbar-inner")!;
        const actions = root.querySelector(".zotero-markdown-toolbar-actions")!;
        assert.equal(actions.parentElement, inner);
        assert.deepEqual(
          [...actions.children].map((button) => button.className),
          [
            "zotero-markdown-btn zotero-markdown-mode-toggle",
            "zotero-markdown-btn zotero-markdown-backlinks-toggle",
            "zotero-markdown-btn zotero-markdown-more",
          ],
        );
        assert.equal(
          inner.firstElementChild?.getAttribute("data-action"),
          "outline-toggle",
        );
        assert.equal(
          root.querySelector(".zotero-markdown-toolbar-spacer"),
          null,
        );
        for (const mode of ["live", "source", "preview"])
          for (const collapsed of [false, true]) {
            root.className = `zotero-markdown-root mode-${mode}${collapsed ? " is-outline-collapsed" : ""}`;
            assert.equal(window.getComputedStyle(actions).flexWrap, "nowrap");
            assert.equal(
              window.getComputedStyle(actions).marginInlineStart,
              "auto",
            );
            for (const button of actions.children) {
              button.setAttribute("aria-expanded", String(!collapsed));
              assert.equal(
                button.textContent,
                "",
                "localized labels do not enlarge icon buttons",
              );
              assert.equal(button.getAttribute("aria-label"), label);
              assert.equal(window.getComputedStyle(button).width, "32px");
              assert.notEqual(
                window.getComputedStyle(button).pointerEvents,
                "none",
              );
            }
          }
        root.remove();
      }
    } finally {
      await window.happyDOM.close();
      if (previousAddon)
        Object.defineProperty(globalThis, "addon", previousAddon);
      else Reflect.deleteProperty(globalThis, "addon");
    }
  });
});
