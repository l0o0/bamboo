import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, StateField } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { Decoration, EditorView } from "@codemirror/view";
import { Window } from "happy-dom";
import { linkTargetAt, openEditorLink } from "../src/editor/link-target.ts";

const state = (doc: string) =>
  EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
const target = (doc: string, label: string) =>
  linkTargetAt(state(doc), doc.indexOf(label) + 1);

test("clicks resolve balanced destinations, escapes and titles from syntax, preserving URI escapes", () => {
  for (const [source, expected] of [
    [
      '[Read](https://example.test/a(b)c "A title")',
      "https://example.test/a(b)c",
    ],
    ["[Read](https://example.test/a\\(b\\))", "https://example.test/a(b)"],
    [
      '[Read](<https://example.test/a%23b> "Title")',
      "https://example.test/a%23b",
    ],
    [
      "[Read](https://example.test/?a=1&amp;b=2)",
      "https://example.test/?a=1&b=2",
    ],
    ["[Read](notes%23data.md#Chapter%201)", "notes%23data.md#Chapter%201"],
    ["[Read\nsecond line](https://example.test)", "https://example.test"],
    [
      "[Read](zotero://select/library/items/ABCD1234)",
      "zotero://select/library/items/ABCD1234",
    ],
  ])
    assert.equal(target(source, "Read"), expected, source);
});

test("reference targets resolve lazily, retain first definitions, and update with the document", () => {
  for (const link of ["[Read][the ref]", "[the ref][]", "[the ref]"]) {
    const doc = `${link}\n\n[THE  REF]:\n  <notes%23data.md#Chapter> "Title"\n\n[the ref]: other.md`;
    assert.equal(linkTargetAt(state(doc), 2), "notes%23data.md#Chapter");
  }
  assert.equal(target("[Read][missing]", "Read"), null);
  assert.equal(
    target("[Read][ref]\n\n```\n[ref]: wrong.md\n```", "Read"),
    null,
  );
  const first = state("[Read][ref]\n\n[ref]: old.md");
  assert.equal(linkTargetAt(first, 2), "old.md");
  const second = first.update({
    changes: {
      from: first.doc.toString().indexOf("old.md"),
      to: first.doc.length,
      insert: "new.md",
    },
  }).state;
  assert.equal(linkTargetAt(second, 2), "new.md");
  assert.equal(linkTargetAt(first, 2), "old.md");
  assert.equal(
    target("[Read][a\\!]\n\n[a!]: wrong.md\n[a\\!]: correct.md", "Read"),
    "correct.md",
  );
  assert.equal(
    target("[Read][Straße]\n\n[STRAẞE]: correct.md", "Read"),
    "correct.md",
  );
  for (const empty of ["[Read]()", "[Read]( )", "[Read](<>)"])
    assert.equal(target(`${empty}\n\n[Read]: wrong.md`, "Read"), null);
});

test("Wiki targets retain aliases and headings without accepting image or escaped syntax", () => {
  assert.equal(
    target("[[Note#Heading|Read]]", "Read"),
    "[[Note#Heading|Read]]",
  );
  assert.equal(target("[[Read]]", "Read"), "[[Read]]");
  assert.equal(target("\\[[Read]]", "Read"), null);
  assert.equal(target("![[Read]]", "Read"), null);
  assert.equal(target("![Read](assets/a.png)", "Read"), null);
});

test("code, image descendants, HTML and frontmatter never become navigation targets", () => {
  for (const source of [
    "`[Read](https://example.test)`",
    "```md\n[Read](https://example.test)\n```",
    "    [Read](https://example.test)",
    "![a [Read](https://example.test)](assets/image.png)",
    "<!--\n[Read](https://example.test)\n-->",
    "<div>\n[Read](https://example.test)\n</div>",
    '---\ntitle: "[Read](https://example.test)"\n---\nText',
  ])
    assert.equal(target(source, "Read"), null, source);
});

test("automatic URL syntax resolves on demand without trusting undefined references", () => {
  assert.equal(
    target("<https://example.test/path>", "example"),
    "https://example.test/path",
  );
  assert.equal(
    target("<reader@example.test>", "reader"),
    "mailto:reader@example.test",
  );
  assert.equal(
    target("See https://example.test/path now.", "example"),
    "https://example.test/path",
  );
  assert.equal(target("[Read] is plain text.", "Read"), null);
  assert.equal(linkTargetAt(state("Text"), -1), null);
  assert.equal(linkTargetAt(state("Text"), 100), null);
});

test("real pointer handling ignores stale DOM hrefs and follows the current source after edits", async (t) => {
  const win = new Window({ url: "https://editor.test/" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const marks = StateField.define({
    create: createMarker,
    update: (_value, transaction) => createMarker(transaction.state),
    provide: (field) => EditorView.decorations.from(field),
  });
  function createMarker(s: EditorState) {
    const text = s.doc.toString();
    const from = text.indexOf("Read");
    const code = text.indexOf("Code");
    return from < 0
      ? Decoration.none
      : Decoration.set(
          [
            Decoration.mark({
              attributes: { "data-zmd-link": "https://stale.invalid" },
            }).range(from, code < 0 ? from + 4 : code + 4),
            ...(code < 0
              ? []
              : [
                  Decoration.mark({ class: "test-inline-code" }).range(
                    code,
                    code + 4,
                  ),
                ]),
          ],
          true,
        );
  }
  const opened: string[] = [];
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const view = new EditorView({
    parent: host as unknown as HTMLElement,
    state: EditorState.create({
      doc: "[Read](https://old.test)",
      extensions: [
        markdown({ extensions: GFM }),
        marks,
        EditorView.domEventHandlers({
          mousedown: (event, editor) =>
            openEditorLink(event, editor, (href) => opened.push(href)),
        }),
      ],
    }),
  });
  t.after(async () => {
    view.destroy();
    await win.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const click = (
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; button?: number } = {
      ctrlKey: true,
    },
  ) => {
    const element = host.querySelector("[data-zmd-link]")!;
    assert.ok(element);
    const event = new win.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...modifiers,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const from = view.state.doc.toString().indexOf("old");
  view.dispatch({ changes: { from, to: from + 3, insert: "new" } });
  click({});
  assert.deepEqual(opened, []);
  assert.equal(click(), true);
  assert.deepEqual(opened, ["https://new.test"]);
  view.dispatch({ changes: { from: 0, insert: "Before\n\n" } });
  assert.equal(click({ metaKey: true }), true);
  assert.deepEqual(opened, ["https://new.test", "https://new.test"]);
  assert.equal(click({ button: 2, ctrlKey: true }), false);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: "Read plain text" },
  });
  click();
  assert.deepEqual(opened, ["https://new.test", "https://new.test"]);
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: "[Read `Code`](https://code.test)",
    },
  });
  const code = host.querySelector(".test-inline-code")!;
  assert.ok(code.closest("[data-zmd-link]"));
  code.dispatchEvent(
    new win.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    }),
  );
  assert.deepEqual(opened, ["https://new.test", "https://new.test"]);
});
