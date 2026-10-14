import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createMarkdownEditor } from "../src/modules/markdown/editor.ts";
import {
  applyDocChanges,
  computeStats,
  EDITOR_MESSAGE_SOURCE,
  EDITOR_PROTOCOL_VERSION,
  type EditorDocChange,
  type EditorToParentMessage,
  type ParentToEditorMessage,
} from "../src/modules/markdown/editor-protocol.ts";

function fixture(
  context: TestContext,
  doc = "中文 initial\nsecond line",
  onSave?: () => void,
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  globals.Zotero = { Prefs: { get: () => undefined } };
  globals.ztoolkit = { log() {} };
  const window = new Window({
    url: "https://editor.test/",
    settings: { disableIframePageLoading: true },
  });
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  const changesSeen: string[] = [];
  const editor = createMarkdownEditor(parent as unknown as HTMLElement, {
    win: window as unknown as globalThis.Window,
    pageURL: "https://editor.test/page.html",
    channel: "stats-test",
    doc,
    onChange: (value) => changesSeen.push(value),
    onSave,
  });
  const iframe = parent.querySelector("iframe")!;
  // Loading is disabled, so provide an isolated message peer without fetching a page.
  const frame = new Window({ url: "https://editor.test/frame/" });
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  const posted: ParentToEditorMessage[] = [];
  iframe.contentWindow!.postMessage = ((data: ParentToEditorMessage) => {
    posted.push(data);
  }) as typeof iframe.contentWindow.postMessage;
  let revision = 0;
  const send = (message: EditorToParentMessage) => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          ...message,
          source: EDITOR_MESSAGE_SOURCE,
          channel: "stats-test",
          v: EDITOR_PROTOCOL_VERSION,
        },
      }),
    );
  };
  const change = (changes: EditorDocChange[]) => {
    send({
      source: EDITOR_MESSAGE_SOURCE,
      type: "change",
      payload: { rev: ++revision, changes },
    });
  };
  send({ source: EDITOR_MESSAGE_SOURCE, type: "ready" });
  context.after(async () => {
    editor.destroy();
    await frame.happyDOM.close();
    await window.happyDOM.close();
    // createMarkdownEditor installs DOM globals from its owner window.
    for (const key of Object.keys(globals)) {
      if (!Object.hasOwn(previous, key)) delete globals[key];
    }
    for (const [key, descriptor] of Object.entries(previous)) {
      if (Object.getOwnPropertyDescriptor(globalThis, key)?.configurable) {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  });
  return { editor, window, posted, send, change, changesSeen };
}

test("statistics retain UTF-16 character counts, LF lines and the existing Chinese word rule", () => {
  for (const [text, expected] of [
    ["", { chars: 0, lines: 1, words: 0 }],
    ["中文", { chars: 2, lines: 1, words: 2 }],
    ["alpha beta 中文 😀", { chars: 16, lines: 1, words: 5 }],
    ["abc中文def", { chars: 8, lines: 1, words: 4 }],
    ["\r\n中\r\n文\n", { chars: 7, lines: 4, words: 2 }],
    ["\u3400\u4dbf\u4e00\u9fff", { chars: 4, lines: 1, words: 4 }],
    ["𠀀", { chars: 2, lines: 1, words: 1 }],
  ] as const) {
    assert.deepEqual(computeStats(text), expected, JSON.stringify(text));
  }
});

test("random batches of original-document changes produce exact current statistics", (context) => {
  const { editor, change } = fixture(context);
  let expected = editor.getValue();
  let seed = 0x81507711;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const fragments = [
    "",
    "a",
    "中文",
    "\n",
    "\n\n",
    "beta gamma",
    "😀",
    "\t",
    "\u00a0",
    "𠀀",
    "文a字",
    "\ud83d",
  ];
  for (let step = 0; step < 700; step++) {
    const midpoint = Math.floor(expected.length / 2);
    const from = random(midpoint + 1);
    const to = from + random(midpoint - from + 1);
    const changes: EditorDocChange[] = [
      { from, to, insert: fragments[random(fragments.length)] },
    ];
    if (expected.length > 1 && random(2)) {
      const from = midpoint + 1 + random(expected.length - midpoint);
      const to = from + random(expected.length - from + 1);
      changes.push({ from, to, insert: fragments[random(fragments.length)] });
    }
    expected = applyDocChanges(expected, changes);
    change(changes);
    assert.equal(editor.getValue(), expected);
    if (step % 9 === 0 || step === 699) {
      const stats = editor.getStats();
      assert.deepEqual(stats, computeStats(expected), `Random change ${step}`);
      assert.equal(
        editor.getStats(),
        stats,
        "Unchanged reads reuse exact stats",
      );
    }
  }
});

test("typing and setValue do not scan the full document until statistics are requested", (context) => {
  const { editor, change } = fixture(context);
  editor.getStats();
  let watched = "";
  let scans = 0;
  const trim = String.prototype.trim;
  // countWords trims the complete body; count only that body, not unrelated DOM text.
  context.mock.method(String.prototype, "trim", function (this: string) {
    if (String(this) === watched) scans++;
    return trim.call(this);
  });
  for (let index = 0; index < 30; index++) {
    watched = `${editor.getValue()}中文 ${index}\n`;
    change([
      {
        from: editor.getValue().length,
        to: editor.getValue().length,
        insert: `中文 ${index}\n`,
      },
    ]);
  }
  assert.equal(scans, 0, "Input changes only invalidate the cached statistics");
  const first = editor.getStats();
  assert.equal(scans, 1);
  assert.equal(editor.getStats(), first);
  assert.equal(
    scans,
    1,
    "Repeated metadata reads do not rescan unchanged text",
  );
  watched = "新的整篇正文\nalpha beta 😀";
  editor.setValue(watched);
  assert.equal(scans, 1, "Replacing the body does not eagerly scan it");
  assert.equal(editor.getStats().chars, watched.length);
  assert.equal(scans, 2);
});

test("setValue is immediately visible while range and selection commands wait for their change echo", (context) => {
  const { editor, change, posted } = fixture(context);
  editor.setValue("中文 alpha\nline two");
  assert.deepEqual(editor.getStats(), computeStats(editor.getValue()));

  const before = editor.getValue();
  const beforeStats = editor.getStats();
  editor.replaceRange(3, 8, "beta 中文");
  assert.equal(editor.getValue(), before);
  assert.equal(editor.getStats(), beforeStats);
  assert.deepEqual(posted.at(-1)?.payload, {
    from: 3,
    to: 8,
    insert: "beta 中文",
  });
  change([{ from: 3, to: 8, insert: "beta 中文" }]);
  assert.deepEqual(editor.getStats(), computeStats(editor.getValue()));

  const selectionValue = editor.getValue();
  editor.insertText("新图\n", 1, 1);
  assert.equal(
    editor.getValue(),
    selectionValue,
    "The parent cannot predict the iframe selection",
  );
  assert.deepEqual(posted.at(-1)?.payload, {
    text: "新图\n",
    selectionFrom: 1,
    selectionTo: 1,
  });
  change([{ from: 0, to: 2, insert: "新图\n" }]);
  assert.deepEqual(editor.getStats(), computeStats(editor.getValue()));
});

test("protocol snapshots adopt precise statistics and later typing invalidates them", async (context) => {
  const { editor, posted, send, change } = fixture(context);
  change([{ from: 0, to: 0, insert: "本地 " }]);
  const snapshot = editor.requestSnapshot();
  const request = posted.at(-1)!;
  assert.equal(request.type, "requestSnapshot");
  if (request.type !== "requestSnapshot") return;
  const value = "快照最新正文\nalpha beta 😀";
  const stats = computeStats(value);
  send({
    source: EDITOR_MESSAGE_SOURCE,
    type: "snapshot",
    payload: { requestId: request.payload.requestId, rev: 10, value, stats },
  });
  assert.equal(await snapshot, value);
  assert.equal(editor.getValue(), value);
  assert.deepEqual(editor.getStats(), stats);
  assert.equal(
    editor.getStats(),
    stats,
    "Snapshot statistics are reused without a second scan",
  );
  change([{ from: value.length, to: value.length, insert: "\n后续编辑" }]);
  assert.deepEqual(editor.getStats(), computeStats(editor.getValue()));
});

test("a snapshot timeout and destroyed-editor fallback expose exact current statistics", async (context) => {
  const { editor, change, window } = fixture(context);
  const setTimeout = window.setTimeout.bind(window);
  context.mock.method(
    window,
    "setTimeout",
    (callback: () => void, delay?: number) =>
      setTimeout(callback, delay === 400 ? 5 : delay),
  );
  change([{ from: 0, to: 0, insert: "缓存最新正文\n" }]);
  const beforeTimeout = editor.getValue();
  assert.equal(await editor.requestSnapshot(), beforeTimeout);
  assert.deepEqual(editor.getStats(), computeStats(beforeTimeout));
  change([{ from: 0, to: 0, insert: "最后一行\n" }]);
  const final = editor.getValue();
  editor.destroy();
  assert.equal(await editor.requestSnapshot(), final);
  assert.deepEqual(editor.getStats(), computeStats(final));
});

test("save callbacks can request an exact current snapshot after a burst of changes", async (context) => {
  let snapshot: Promise<string> | undefined;
  const { editor, change, posted, send } = fixture(
    context,
    "Original 中文",
    () => {
      snapshot = editor.requestSnapshot();
    },
  );
  for (let index = 0; index < 12; index++) {
    const length = editor.getValue().length;
    change([{ from: length, to: length, insert: "\n保存内容" }]);
  }
  const expected = editor.getValue();
  send({ source: EDITOR_MESSAGE_SOURCE, type: "save" });
  assert.ok(snapshot, "The save message invokes the snapshot-taking callback");
  const request = posted.at(-1)!;
  assert.equal(request.type, "requestSnapshot");
  if (request.type !== "requestSnapshot") return;
  send({
    source: EDITOR_MESSAGE_SOURCE,
    type: "snapshot",
    payload: {
      requestId: request.payload.requestId,
      rev: 12,
      value: expected,
      stats: computeStats(expected),
    },
  });
  const saved = await snapshot;
  assert.equal(saved, expected);
  assert.deepEqual(editor.getStats(), computeStats(saved));
});
