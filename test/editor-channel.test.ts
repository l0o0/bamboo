import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_MESSAGE_SOURCE,
  applyDocChanges,
  isEditorProtocolMessageForChannel,
} from "../src/modules/markdown/editor-protocol.ts";

test("accepts editor messages only from the matching session channel", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-3:item-303",
    type: "change",
    payload: {
      rev: 3,
      changes: [{ from: 0, to: 0, insert: "third document" }],
    },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-3:item-303"),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-1:item-101"),
    false,
  );
});

test("rejects unscoped editor messages when a channel is required", () => {
  assert.equal(
    isEditorProtocolMessageForChannel(
      { source: EDITOR_MESSAGE_SOURCE, type: "ready" },
      "tab-1:item-101",
    ),
    false,
  );
});

test("composition messages require an actual boolean and the owning channel", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "ime",
    type: "composition",
  };
  for (const active of [true, false]) {
    assert.equal(
      isEditorProtocolMessageForChannel(
        { ...message, payload: { active } },
        "ime",
      ),
      true,
    );
    assert.equal(
      isEditorProtocolMessageForChannel(
        { ...message, payload: { active } },
        "another-editor",
      ),
      false,
    );
  }
  for (const payload of [
    undefined,
    null,
    {},
    true,
    { active: "false" },
    { active: 1 },
  ])
    assert.equal(
      isEditorProtocolMessageForChannel({ ...message, payload }, "ime"),
      false,
    );
});

test("applies original-document changes from last to first", () => {
  assert.equal(
    applyDocChanges("hello world", [
      { from: 0, to: 5, insert: "hey" },
      { from: 6, to: 11, insert: "there" },
    ]),
    "hey there",
  );
});

test("does not accept another tab's outline update", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-3:item-303",
    type: "outline",
    payload: {
      items: [{ id: "h1:0", level: 1, text: "Third", from: 0 }],
      activeID: "h1:0",
    },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-1:item-101"),
    false,
  );
});

test("validates document-link bridge payloads and candidates", () => {
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "openLink",
        payload: { href: "zotero://select/library/items/AB12CD34" },
      },
      "tab-1:item-101",
    ),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "linkSearch",
        payload: { requestId: -1, query: "x" },
      },
      "tab-1:item-101",
    ),
    false,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "tab-1:item-101",
        type: "linkSearchResults",
        payload: {
          requestId: 1,
          query: "x",
          results: [
            {
              key: "AB12CD34",
              libraryID: 1,
              title: "Doc",
              kind: "markdown",
              href: "javascript:alert(1)",
            },
          ],
        },
      },
      "tab-1:item-101",
    ),
    false,
  );
});

test("appearance messages accept only supported fonts and plain hex colors", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "settings",
    type: "setAppearance",
    payload: { fontFamily: "serif", backgroundColor: "#f7efdc" },
  };
  assert.equal(isEditorProtocolMessageForChannel(message, "settings"), true);
  for (const payload of [
    null,
    {},
    { fontFamily: "url(x)", backgroundColor: "" },
    { fontFamily: "serif", backgroundColor: "url(x)" },
  ]) {
    assert.equal(
      isEditorProtocolMessageForChannel({ ...message, payload }, "settings"),
      false,
    );
  }
});

test("link search filters are constrained and echoed replies accept the same scope", () => {
  for (const filter of [
    undefined,
    "all",
    "regular",
    "notes-attachments",
    "open",
    "unknown",
    null,
    {},
    1,
  ]) {
    const valid =
      filter === undefined ||
      (typeof filter === "string" && filter !== "unknown");
    for (const type of ["linkSearch", "linkSearchResults"]) {
      assert.equal(
        isEditorProtocolMessageForChannel(
          {
            source: EDITOR_MESSAGE_SOURCE,
            channel: "links",
            type,
            payload: {
              requestId: 1,
              query: "研究",
              filter,
              ...(type === "linkSearchResults" ? { results: [] } : {}),
            },
          },
          "links",
        ),
        valid,
      );
    }
  }
});

test("native note and attachment candidates permit only packaged item icons and matching Zotero links", () => {
  for (const kind of ["note", "attachment"]) {
    const candidate = {
      key: "AB12CD34",
      libraryID: 1,
      title: "Research",
      kind,
      href: "zotero://select/library/items/AB12CD34",
    };
    const accepts = (changes: object) =>
      isEditorProtocolMessageForChannel(
        {
          source: EDITOR_MESSAGE_SOURCE,
          channel: "links",
          type: "linkSearchResults",
          payload: {
            requestId: 1,
            query: "",
            filter: "all",
            results: [{ ...candidate, ...changes }],
          },
        },
        "links",
      );
    for (const icon of [
      undefined,
      "chrome://zotero/skin/item-type/16/light/journal-article.svg",
      "chrome://zotero/skin/item-type/16/dark/attachment-pdf@2x.svg",
      "chrome://bamboo/content/icons/attachment-markdown.svg",
    ])
      assert.equal(accepts({ icon }), true);
    for (const icon of [
      "https://example.com/tracker.svg",
      "data:image/svg+xml,<svg/>",
      "chrome://zotero/content/unsafe.svg",
      "chrome://bamboo/content/editor/foo.svg",
      "chrome://zotero/skin/../content/file.svg",
      "chrome://zotero/skin/icon.svg?url=secret",
      null,
      1,
    ])
      assert.equal(accepts({ icon }), false);
    assert.equal(
      accepts({ href: "zotero://select/library/items/WRONG001" }),
      false,
    );
    assert.equal(accepts({ href: "Research--AB12CD34.md" }), false);
    assert.equal(
      accepts({
        groupID: 42,
        href: "zotero://select/groups/42/items/AB12CD34",
      }),
      true,
    );
  }
});

test("candidate author metadata is optional and accepts only bounded nonblank names", () => {
  const accepts = (author: unknown) =>
    isEditorProtocolMessageForChannel(
      {
        source: EDITOR_MESSAGE_SOURCE,
        channel: "links",
        type: "linkSearchResults",
        payload: {
          requestId: 1,
          query: "研究",
          filter: "all",
          results: [
            {
              key: "AB12CD34",
              libraryID: 1,
              title: "Research",
              kind: "regular",
              href: "zotero://select/library/items/AB12CD34",
              author,
            },
          ],
        },
      },
      "links",
    );
  for (const author of [undefined, "张三", "Jane Doe", "研".repeat(200)]) {
    assert.equal(accepts(author), true);
  }
  for (const author of ["", " \t\n ", "研".repeat(201), null, 1, {}, []]) {
    assert.equal(accepts(author), false);
  }
});
