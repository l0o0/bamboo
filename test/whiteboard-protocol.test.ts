import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parseCanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  EDITOR_MESSAGE_SOURCE,
  isEditorProtocolMessageForChannel,
} from "../src/modules/markdown/editor-protocol.ts";
import {
  WHITEBOARD_MESSAGE_SOURCE,
  WHITEBOARD_PROTOCOL_VERSION,
  dispatchWhiteboardParentMessageEvent,
  isParentToWhiteboardMessageForChannel,
  isWhiteboardProtocolMessage,
  isWhiteboardProtocolMessageForChannel,
  isWhiteboardToParentMessageForChannel,
  whiteboardChannel,
  type ParentToWhiteboardMessage,
  type SourceResolutionPriority,
  type WhiteboardToParentMessage,
} from "../src/modules/whiteboard/protocol.ts";

type Assert<T extends true> = T;
type SnapshotDocument = Extract<
  WhiteboardToParentMessage,
  { type: "snapshot" }
>["payload"]["snapshot"];
type InitDocument = NonNullable<
  Extract<ParentToWhiteboardMessage, { type: "init" }>["payload"]["snapshot"]
>;
type ResolvePriority = Extract<
  WhiteboardToParentMessage,
  { type: "resolveAcademicSources" }
>["payload"]["priority"];
type _SnapshotUsesSchemaV2 = Assert<
  SnapshotDocument extends { version: 2; nodes: unknown[] } ? true : false
>;
type _InitUsesSchemaV2 = Assert<
  InitDocument extends { version: 2; connections: unknown[] } ? true : false
>;
type _ResolvePriorityIsTyped = Assert<
  ResolvePriority extends SourceResolutionPriority
    ? SourceResolutionPriority extends ResolvePriority
      ? true
      : false
    : false
>;

const literatureSource = {
  library: { type: "user" },
  itemKey: "ITEM1234",
} as const;
const noteSource = { library: { type: "user" }, noteKey: "NOTE1234" } as const;
const quoteSource = {
  ...literatureSource,
  attachmentKey: "ATTACH123",
  annotationKey: "ANNOT1234",
} as const;

const emptyDocument = {
  version: 2,
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
} as const;
const literatureAcquisition = {
  kind: "literature",
  source: literatureSource,
  snapshot: {
    title: "Paper",
    creators: "Ada Lovelace",
    year: "1843",
    publicationTitle: "Notes",
    tags: ["math"],
    annotationCount: 2,
  },
} as const;
const noteAcquisition = {
  kind: "note",
  source: { ...noteSource, itemKey: "ITEM1234" },
  sourceSnapshot: { title: "Source note" },
  content: "Note body",
} as const;
const quoteAcquisition = {
  kind: "quote",
  source: quoteSource,
  snapshot: {
    text: "Quoted text",
    comment: "Comment",
    citation: "Citation",
    pageLabel: "12",
    color: "#ffd400",
  },
} as const;

const protocolBase = {
  source: WHITEBOARD_MESSAGE_SOURCE,
  channel: "tab-9:canvas-a",
  v: WHITEBOARD_PROTOCOL_VERSION,
} as const;

function acceptsAcquisition(acquisition: unknown): boolean {
  return isParentToWhiteboardMessageForChannel(
    {
      ...protocolBase,
      type: "academicSourcesAcquired",
      payload: {
        requestId: "acquire-1",
        nodeId: "node-1",
        successes: [{ index: 0, acquisition }],
        failures: [],
      },
    },
    protocolBase.channel,
  );
}

test("file, loadSnapshot and acquisition messages agree on Academic field values", () => {
  const cases: Array<[Record<string, unknown>, boolean]> = [
    [literatureAcquisition, true],
    [noteAcquisition, true],
    [quoteAcquisition, true],
    [{ ...noteAcquisition, source: noteSource, sourceSnapshot: {} }, true],
    [{ ...noteAcquisition, source: { ...noteSource, itemKey: "" } }, false],
    [{ ...noteAcquisition, sourceSnapshot: { title: 123 } }, false],
    [
      { ...quoteAcquisition, source: { ...quoteSource, annotationKey: "" } },
      false,
    ],
    [
      { ...quoteAcquisition, snapshot: { text: "Quote", pageLabel: 12 } },
      false,
    ],
    [
      { ...literatureAcquisition, snapshot: { title: "Paper", tags: [123] } },
      false,
    ],
  ];
  for (const annotationCount of [
    0,
    Number.MAX_SAFE_INTEGER,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    cases.push([
      {
        ...literatureAcquisition,
        snapshot: { title: "Paper", annotationCount },
      },
      Number.isSafeInteger(annotationCount) && annotationCount >= 0,
    ]);
  }
  for (const groupID of [1, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    cases.push([
      {
        ...literatureAcquisition,
        source: { library: { type: "group", groupID }, itemKey: "ITEM1234" },
      },
      Number.isSafeInteger(groupID) && groupID > 0,
    ]);
  }
  for (const [acquisition, expected] of cases) {
    const document = {
      ...emptyDocument,
      nodes: [
        {
          id: "node-1",
          position: { x: 0, y: 0 },
          width: 260,
          height: 152,
          ...acquisition,
        },
      ],
    };
    const parsed = parseCanvasDocument(document);
    assert.equal(
      parsed.issues.length === 0,
      expected,
      JSON.stringify(acquisition),
    );
    assert.equal(acceptsAcquisition(acquisition), expected);
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...protocolBase,
          type: "loadSnapshot",
          payload: { snapshot: document },
        },
        protocolBase.channel,
      ),
      expected,
    );
  }
});

test("Academic wire optionals allow own undefined but reject unknown or inherited fields", () => {
  for (const acquisition of [
    {
      ...literatureAcquisition,
      snapshot: {
        title: "Paper",
        creators: undefined,
        year: undefined,
        publicationTitle: undefined,
        tags: undefined,
        annotationCount: undefined,
      },
    },
    {
      ...quoteAcquisition,
      snapshot: {
        text: "Quote",
        comment: undefined,
        citation: undefined,
        pageLabel: undefined,
        color: undefined,
      },
    },
    {
      ...noteAcquisition,
      source: { ...noteSource, itemKey: undefined },
      sourceSnapshot: { title: undefined },
    },
    { ...noteAcquisition, sourceSnapshot: undefined },
  ]) {
    assert.equal(acceptsAcquisition(acquisition), true);
  }
  assert.equal(
    acceptsAcquisition({
      ...literatureAcquisition,
      snapshot: { title: "Paper", extra: undefined },
    }),
    false,
  );
  assert.equal(
    acceptsAcquisition({
      ...literatureAcquisition,
      source: { ...literatureSource, library: { type: "user", groupID: 7 } },
    }),
    false,
  );
  assert.equal(
    acceptsAcquisition({
      ...noteAcquisition,
      source: Object.assign(
        Object.create({ itemKey: "INHERITED" }),
        noteSource,
      ),
    }),
    false,
  );
});

test("shared Academic parsers cannot evaluate nested wire accessors or sparse tags", () => {
  let reads = 0;
  const library = Object.defineProperty({}, "type", {
    enumerable: true,
    get: () => {
      reads += 1;
      return "user";
    },
  });
  const tags = Object.defineProperty([], "0", {
    enumerable: true,
    get: () => {
      reads += 1;
      return "tag";
    },
  });
  assert.equal(
    acceptsAcquisition({
      ...literatureAcquisition,
      source: { library, itemKey: "ITEM1234" },
    }),
    false,
  );
  for (const invalidTags of [tags, new Array(1)]) {
    assert.equal(
      acceptsAcquisition({
        ...literatureAcquisition,
        snapshot: { title: "Paper", tags: invalidTags },
      }),
      false,
    );
  }
  assert.equal(reads, 0);
});

const activeIframeToHostMessages = [
  { ...protocolBase, type: "ready" },
  { ...protocolBase, type: "change", payload: { rev: 4 } },
  {
    ...protocolBase,
    type: "snapshot",
    payload: { requestId: "snapshot-1", rev: 4, snapshot: emptyDocument },
  },
  { ...protocolBase, type: "save" },
  { ...protocolBase, type: "switchWindow" },
  { ...protocolBase, type: "openSettings" },
  { ...protocolBase, type: "error", payload: { message: "render failed" } },
  {
    ...protocolBase,
    type: "pickAcademicSource",
    payload: { requestId: "pick-1", nodeId: "node-1", kind: "literature" },
  },
  {
    ...protocolBase,
    type: "openItem",
    payload: { itemID: 1, attachmentID: 2, pdfPage: 3 },
  },
  {
    ...protocolBase,
    type: "dropAcademicSources",
    payload: {
      requestId: "drop-1",
      nodeId: "node-2",
      sources: [
        literatureSource,
        { library: { type: "group", groupID: 7 }, itemKey: "GROUP123" },
      ],
    },
  },
  {
    ...protocolBase,
    type: "resolveAcademicSources",
    payload: {
      requestId: "resolve-1",
      generation: 2,
      priority: "selected",
      sources: [
        {
          nodeId: "node-3",
          source: { kind: "literature", source: literatureSource },
          refresh: true,
        },
        {
          nodeId: "node-4",
          source: { kind: "note", source: noteSource },
        },
        {
          nodeId: "node-5",
          source: { kind: "quote", source: quoteSource },
        },
      ],
    },
  },
  {
    ...protocolBase,
    type: "listLiteratureAnnotations",
    payload: { requestId: "annotations-1", source: literatureSource },
  },
  {
    ...protocolBase,
    type: "refreshZoteroNote",
    payload: { requestId: "note-1", nodeId: "node-4", source: noteSource },
  },
  {
    ...protocolBase,
    type: "openAcademicSource",
    payload: {
      requestId: "open-1",
      nodeId: "node-5",
      source: { kind: "quote", source: quoteSource },
    },
  },
  {
    ...protocolBase,
    type: "exportFile",
    payload: {
      requestId: "export-1",
      format: "svg",
      mimeType: "image/svg+xml",
      dataUrl: "data:image/svg+xml,canvas",
      text: "<svg />",
    },
  },
  {
    ...protocolBase,
    type: "saveNoteTemplate",
    payload: {
      template: {
        id: "custom-1",
        name: "Hypothesis",
        style: { fontWeight: "bold" },
        updatedAt: "2026-09-06T00:00:00.000Z",
      },
    },
  },
  {
    ...protocolBase,
    type: "deleteNoteTemplate",
    payload: { templateId: "custom-1" },
  },
] satisfies Array<WhiteboardToParentMessage>;

const activeHostToIframeMessages = [
  {
    ...protocolBase,
    type: "init",
    payload: { theme: "dark", snapshot: emptyDocument },
  },
  { ...protocolBase, type: "setTheme", payload: { theme: "light" } },
  {
    ...protocolBase,
    type: "setColorScheme",
    payload: { colorScheme: "traditional" },
  },
  {
    ...protocolBase,
    type: "loadSnapshot",
    payload: { snapshot: emptyDocument },
  },
  {
    ...protocolBase,
    type: "requestSnapshot",
    payload: { requestId: "snapshot-1" },
  },
  { ...protocolBase, type: "command", payload: { command: "undo" } },
  { ...protocolBase, type: "focus" },
  { ...protocolBase, type: "destroy" },
  {
    ...protocolBase,
    type: "academicSourcesAcquired",
    payload: {
      requestId: "batch-1",
      nodeId: "node-2",
      successes: [
        { index: 0, acquisition: literatureAcquisition },
        { index: 1, acquisition: noteAcquisition },
      ],
      failures: [
        {
          index: 2,
          code: "unsupported-attachment",
          message: "Unsupported attachment",
        },
      ],
    },
  },
  {
    ...protocolBase,
    type: "academicDropStarted",
    payload: {
      requestId: "drop-1",
      nodeId: "node-3",
      position: { x: 10, y: 20 },
      sources: [literatureSource],
    },
  },
  {
    ...protocolBase,
    type: "academicDropRejected",
    payload: { code: "drop-malformed" },
  },
  {
    ...protocolBase,
    type: "sourceResolutionBatch",
    payload: {
      requestId: "resolve-1",
      generation: 2,
      results: [
        {
          nodeId: "node-4",
          generation: 2,
          status: "resolved",
          acquisition: quoteAcquisition,
        },
        {
          nodeId: "node-5",
          generation: 2,
          status: "unavailable",
          code: "resolution-failed",
          message: "Unavailable",
        },
      ],
    },
  },
  {
    ...protocolBase,
    type: "annotationsListed",
    payload: {
      requestId: "annotations-1",
      source: literatureSource,
      candidates: [
        {
          acquisition: quoteAcquisition,
          attachmentTitle: "Paper.pdf",
          sortIndex: "0001",
        },
      ],
      failures: [
        {
          code: "annotation-unavailable",
          message: "Missing annotation",
          attachmentKey: "ATTACH123",
          annotationKey: "ANNOT1234",
        },
      ],
    },
  },
  {
    ...protocolBase,
    type: "annotationListFailed",
    payload: {
      requestId: "annotations-2",
      source: literatureSource,
      failure: {
        code: "attachment-unavailable",
        message: "Missing attachment",
        attachmentKey: "ATTACH123",
        annotationKey: "ANNOT1234",
      },
    },
  },
  {
    ...protocolBase,
    type: "noteRefreshed",
    payload: {
      requestId: "note-1",
      nodeId: "node-6",
      acquisition: noteAcquisition,
    },
  },
  {
    ...protocolBase,
    type: "academicRequestFailed",
    payload: {
      requestId: "request-1",
      nodeId: "node-7",
      code: "acquisition-failed",
      diagnostic: "host diagnostic",
    },
  },
  {
    ...protocolBase,
    type: "sourceActionFailed",
    payload: {
      requestId: "open-1",
      nodeId: "node-8",
      source: { kind: "literature", source: literatureSource },
      failure: { code: "open-failed", message: "Could not open" },
    },
  },
  {
    ...protocolBase,
    type: "sourceActionSucceeded",
    payload: {
      requestId: "open-2",
      nodeId: "node-8",
      action: "open",
      source: { kind: "literature", source: literatureSource },
    },
  },
  {
    ...protocolBase,
    type: "saveState",
    payload: { state: "saving" },
  },
  {
    ...protocolBase,
    type: "noteTemplatesChanged",
    payload: {
      templates: [
        {
          id: "custom-1",
          name: "Hypothesis",
          style: {},
          updatedAt: "2026-09-06T00:00:00.000Z",
        },
      ],
    },
  },
] satisfies Array<ParentToWhiteboardMessage>;

test("template messages reject unknown or malformed fields", () => {
  assert.equal(
    isWhiteboardToParentMessageForChannel(
      {
        ...protocolBase,
        type: "saveNoteTemplate",
        payload: {
          template: {
            id: "custom-1",
            name: "Bad",
            style: { arbitraryCss: "position: fixed" },
            updatedAt: "2026-09-06T00:00:00.000Z",
          },
        },
      },
      protocolBase.channel,
    ),
    false,
  );
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        ...protocolBase,
        type: "noteTemplatesChanged",
        payload: { templates: [{ id: "", name: "Bad", style: {} }] },
      },
      protocolBase.channel,
    ),
    false,
  );
});

test("whiteboard channel is tab plus canvas id", () => {
  assert.equal(whiteboardChannel("tab-9", "canvas-a"), "tab-9:canvas-a");
});

test("accepts whiteboard messages only from the matching session channel", () => {
  const message = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-9:canvas-a",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "change",
    payload: { rev: 3 },
  };
  assert.equal(
    isWhiteboardProtocolMessageForChannel(message, "tab-9:canvas-a"),
    true,
  );
  assert.equal(
    isWhiteboardProtocolMessageForChannel(message, "tab-1:canvas-b"),
    false,
  );
});

test("protocol v2 accepts only exact versions and session channels", () => {
  assert.equal(WHITEBOARD_PROTOCOL_VERSION, 2);
  assert.equal(
    isWhiteboardProtocolMessage({
      source: WHITEBOARD_MESSAGE_SOURCE,
      channel: "tab:canvas",
      v: 1,
      type: "ready",
    }),
    false,
  );
  assert.equal(
    isWhiteboardProtocolMessage({
      source: WHITEBOARD_MESSAGE_SOURCE,
      channel: "tab:canvas",
      type: "ready",
    }),
    false,
  );
  assert.equal(
    isWhiteboardProtocolMessageForChannel(
      {
        source: WHITEBOARD_MESSAGE_SOURCE,
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "ready",
      },
      "tab:canvas",
    ),
    false,
  );
  assert.equal(
    isWhiteboardProtocolMessage({
      source: WHITEBOARD_MESSAGE_SOURCE,
      v: WHITEBOARD_PROTOCOL_VERSION,
      type: "ready",
    }),
    false,
  );
  assert.equal(
    isWhiteboardProtocolMessageForChannel(
      {
        source: WHITEBOARD_MESSAGE_SOURCE,
        channel: "other:canvas",
        v: WHITEBOARD_PROTOCOL_VERSION,
        type: "ready",
      },
      "tab:canvas",
    ),
    false,
  );
});

test("closed validators accept every active v2 message arm across realms", () => {
  for (const message of activeIframeToHostMessages) {
    const crossRealm = runInNewContext(`(${JSON.stringify(message)})`);
    assert.equal(
      isWhiteboardToParentMessageForChannel(crossRealm, "tab-9:canvas-a"),
      true,
      `iframe-to-host ${message.type}`,
    );
  }
  for (const message of activeHostToIframeMessages) {
    const crossRealm = runInNewContext(`(${JSON.stringify(message)})`);
    assert.equal(
      isParentToWhiteboardMessageForChannel(crossRealm, "tab-9:canvas-a"),
      true,
      `host-to-iframe ${message.type}`,
    );
  }
});

test("rejects markdown editor messages as whiteboard traffic", () => {
  const editorMessage = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-9:canvas-a",
    type: "ready",
  };
  assert.equal(isWhiteboardProtocolMessage(editorMessage), false);
  assert.equal(
    isEditorProtocolMessageForChannel(editorMessage, "tab-9:canvas-a"),
    true,
  );
});

test("strict ingress requires own envelope fields and rejects prototype pollution", () => {
  const inheritedReady = Object.create({
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab:canvas",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "ready",
  });
  assert.equal(
    isWhiteboardToParentMessageForChannel(inheritedReady, "tab:canvas"),
    false,
  );
  assert.equal(isWhiteboardProtocolMessage(inheritedReady), false);
  const ownButForged = Object.assign(
    Object.create({ forged: true }),
    protocolBase,
    { type: "ready" },
  );
  assert.equal(
    isWhiteboardToParentMessageForChannel(ownButForged, "tab-9:canvas-a"),
    false,
  );
  const forgedPrototype = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(forgedPrototype, "constructor", {
    configurable: true,
    value: Object,
    writable: true,
  });
  const forgedNullParent = Object.assign(
    Object.create(forgedPrototype),
    protocolBase,
    { type: "ready" },
  );
  assert.equal(
    isWhiteboardToParentMessageForChannel(forgedNullParent, "tab-9:canvas-a"),
    false,
  );
  const selfConsistentPrototype = Object.create(null) as Record<
    string,
    unknown
  >;
  const ForgedObject = function Object() {};
  ForgedObject.prototype = selfConsistentPrototype;
  Object.defineProperty(selfConsistentPrototype, "constructor", {
    configurable: true,
    value: ForgedObject,
    writable: true,
  });
  const selfConsistentForgery = Object.assign(
    Object.create(selfConsistentPrototype),
    protocolBase,
    { type: "ready" },
  );
  assert.equal(
    isWhiteboardToParentMessageForChannel(
      selfConsistentForgery,
      "tab-9:canvas-a",
    ),
    false,
  );
  const nullPrototypeReady = Object.assign(Object.create(null), protocolBase, {
    type: "ready",
  });
  assert.equal(
    isWhiteboardToParentMessageForChannel(nullPrototypeReady, "tab-9:canvas-a"),
    true,
  );
  const accessorReady = { ...protocolBase } as Record<string, unknown>;
  Object.defineProperty(accessorReady, "type", {
    enumerable: true,
    get: () => "ready",
  });
  assert.equal(
    isWhiteboardToParentMessageForChannel(accessorReady, "tab-9:canvas-a"),
    false,
  );
  assert.equal(
    isWhiteboardToParentMessageForChannel(
      { ...protocolBase, type: "ready", [Symbol("forged")]: true },
      "tab-9:canvas-a",
    ),
    false,
  );

  class ForgedPayload {
    rev = 1;
  }
  for (const payload of [
    null,
    [],
    new Date(),
    new Map(),
    new ForgedPayload(),
    () => ({ rev: 1 }),
  ]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        { ...protocolBase, type: "change", payload },
        "tab-9:canvas-a",
      ),
      false,
    );
  }
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("hostile prototype trap");
      },
    },
  );
  assert.doesNotThrow(() => {
    assert.equal(
      isWhiteboardToParentMessageForChannel(hostile, "tab-9:canvas-a"),
      false,
    );
  });

  const pollutedKeys = ["source", "channel", "v", "type", "payload"];
  const previous = new Map(
    pollutedKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(Object.prototype, key),
    ]),
  );
  try {
    Object.defineProperties(Object.prototype, {
      source: { configurable: true, value: WHITEBOARD_MESSAGE_SOURCE },
      channel: { configurable: true, value: "tab:canvas" },
      v: { configurable: true, value: WHITEBOARD_PROTOCOL_VERSION },
      type: { configurable: true, value: "ready" },
      payload: { configurable: true, value: undefined },
    });
    assert.equal(
      isWhiteboardToParentMessageForChannel({}, "tab:canvas"),
      false,
    );
    assert.equal(isWhiteboardProtocolMessage({}), false);
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        {
          source: WHITEBOARD_MESSAGE_SOURCE,
          channel: "tab:canvas",
          v: WHITEBOARD_PROTOCOL_VERSION,
          type: "ready",
        },
        "tab:canvas",
      ),
      false,
      "an inherited payload field must not become part of a payloadless arm",
    );
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  }
});

test("all public protocol boundaries reject hostile reflective values without throwing", () => {
  const batch = activeHostToIframeMessages.find(
    (message) => message.type === "sourceResolutionBatch",
  )!;
  const throwingOwnKeys = new Proxy([], {
    ownKeys() {
      throw new Error("ownKeys trap");
    },
  });
  const throwingLength = new Proxy([], {
    get(target, key, receiver) {
      if (key === "length") throw new Error("length trap");
      return Reflect.get(target, key, receiver);
    },
  });
  const throwingElement = new Proxy([batch.payload.results[0]], {
    get(target, key, receiver) {
      if (key === "0") throw new Error("element trap");
      return Reflect.get(target, key, receiver);
    },
  });
  const iteratorTarget: unknown[] = [];
  Object.defineProperty(iteratorTarget, Symbol.iterator, {
    configurable: true,
    get() {
      throw new Error("iterator trap");
    },
  });
  const accessorArray: unknown[] = new Array(1);
  Object.defineProperty(accessorArray, "0", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("array accessor trap");
    },
  });
  const throwingDescriptor = new Proxy([], {
    getOwnPropertyDescriptor() {
      throw new Error("descriptor trap");
    },
  });
  const throwingRecordGet = new Proxy(
    {},
    {
      get() {
        throw new Error("record get trap");
      },
    },
  );
  for (const [results, expected] of [
    [throwingOwnKeys, false],
    // Descriptor-based validation does not invoke these hostile getters, so
    // the otherwise-valid indexed array remains safe to accept.
    [throwingLength, true],
    [throwingElement, true],
    [iteratorTarget, false],
    [accessorArray, false],
    [throwingDescriptor, false],
  ] as const) {
    const hostile = {
      ...batch,
      payload: { ...batch.payload, results },
    };
    assert.doesNotThrow(() => {
      assert.equal(
        isParentToWhiteboardMessageForChannel(hostile, "tab-9:canvas-a"),
        expected,
      );
      assert.equal(
        isWhiteboardProtocolMessageForChannel(hostile, "tab-9:canvas-a"),
        true,
      );
    });
  }
  assert.doesNotThrow(() => {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        { ...batch, payload: throwingRecordGet },
        "tab-9:canvas-a",
      ),
      false,
    );
  });

  const hostileEvent = new Proxy(
    {},
    {
      get() {
        throw new Error("event getter trap");
      },
    },
  );
  const peer = {} as WindowProxy;
  assert.doesNotThrow(() => {
    assert.equal(
      dispatchWhiteboardParentMessageEvent(
        hostileEvent as Pick<MessageEvent, "data" | "source">,
        peer,
        "tab-9:canvas-a",
        () => assert.fail("hostile event must not dispatch"),
      ),
      false,
    );
  });
});

test("hostile ingress never evaluates Symbol.toStringTag accessors", () => {
  const focus = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab-9:canvas-a",
    v: WHITEBOARD_PROTOCOL_VERSION,
    type: "focus",
  };
  let ownTagReads = 0;
  const ownTagged = { ...focus };
  Object.defineProperty(ownTagged, Symbol.toStringTag, {
    configurable: true,
    get() {
      ownTagReads += 1;
      return "Object";
    },
  });
  assert.equal(
    dispatchWhiteboardParentMessageEvent(
      { data: ownTagged, source: null },
      {} as WindowProxy,
      "tab-9:canvas-a",
      () => assert.fail("symbol-bearing ingress must not dispatch"),
    ),
    false,
  );
  assert.equal(ownTagReads, 0, "an own toStringTag getter must remain inert");

  let inheritedTagReads = 0;
  const hostilePrototype = Object.create(null) as object;
  Object.defineProperty(hostilePrototype, Symbol.toStringTag, {
    configurable: true,
    get() {
      inheritedTagReads += 1;
      return "Object";
    },
  });
  const inheritedTagged = Object.assign(
    Object.create(hostilePrototype) as Record<string, unknown>,
    focus,
  );
  assert.equal(
    isParentToWhiteboardMessageForChannel(inheritedTagged, "tab-9:canvas-a"),
    false,
  );
  assert.equal(
    inheritedTagReads,
    0,
    "an inherited toStringTag getter must remain inert",
  );

  let constructorPropertyReads = 0;
  const fakeObjectConstructor = new Proxy(function Object() {}, {
    get(target, key, receiver) {
      constructorPropertyReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const constructorPrototype = Object.create(null) as object;
  Object.defineProperty(constructorPrototype, "constructor", {
    configurable: true,
    value: fakeObjectConstructor,
  });
  const constructorTagged = Object.assign(
    Object.create(constructorPrototype) as Record<string, unknown>,
    focus,
  );
  assert.equal(
    isParentToWhiteboardMessageForChannel(constructorTagged, "tab-9:canvas-a"),
    false,
  );
  assert.equal(
    constructorPropertyReads,
    0,
    "constructor verification must use descriptors instead of property reads",
  );
});

test("strict ingress rejects extra keys throughout native academic records", () => {
  const base = {
    source: WHITEBOARD_MESSAGE_SOURCE,
    channel: "tab:canvas",
    v: WHITEBOARD_PROTOCOL_VERSION,
  } as const;
  const drop = {
    ...base,
    type: "dropAcademicSources",
    payload: {
      requestId: "drop-1",
      nodeId: "node-1",
      sources: [{ library: { type: "user" }, itemKey: "ITEM1234" }],
    },
  };
  assert.equal(isWhiteboardToParentMessageForChannel(drop, "tab:canvas"), true);
  for (const message of [
    { ...drop, extra: true },
    { ...drop, payload: { ...drop.payload, raw: {} } },
    {
      ...drop,
      payload: {
        ...drop.payload,
        sources: [{ ...drop.payload.sources[0], itemID: 42 }],
      },
    },
    {
      ...drop,
      payload: {
        ...drop.payload,
        sources: [
          {
            ...drop.payload.sources[0],
            library: { type: "user", groupID: 7 },
          },
        ],
      },
    },
  ]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(message, "tab:canvas"),
      false,
    );
  }

  const acquired = activeHostToIframeMessages.find(
    (message) => message.type === "academicSourcesAcquired",
  )!;
  assert.equal(
    isParentToWhiteboardMessageForChannel(acquired, "tab-9:canvas-a"),
    true,
  );
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        ...acquired,
        payload: {
          ...acquired.payload,
          successes: [
            {
              index: 0,
              acquisition: { ...literatureAcquisition, extra: true },
            },
          ],
        },
      },
      "tab-9:canvas-a",
    ),
    false,
  );
});

test("null-source init requires complete labels and a canonical canvas document", () => {
  const source = readFileSync(
    new URL("../packages/whiteboard/src/model/protocol.ts", import.meta.url),
    "utf8",
  );
  const labelsBody = source.match(
    /export interface WhiteboardLabels \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(labelsBody);
  const stringKeys = [...labelsBody.matchAll(/^ {2}(\w+): string;$/gm)].map(
    (match) => match[1],
  );
  const labels = Object.fromEntries(stringKeys.map((key) => [key, key])) as
    Record<string, unknown> | undefined;
  assert.ok(labels);
  labels.annotations = { one: "annotation", other: "annotations" };
  const init = {
    ...protocolBase,
    type: "init",
    payload: { theme: "light", snapshot: emptyDocument, labels },
  };
  assert.equal(
    isParentToWhiteboardMessageForChannel(init, "tab-9:canvas-a"),
    true,
  );
  for (const editable of [true, false]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        { ...init, payload: { ...init.payload, editable } },
        "tab-9:canvas-a",
      ),
      true,
    );
  }
  for (const editable of ["false", 0, null]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        { ...init, payload: { ...init.payload, editable } },
        "tab-9:canvas-a",
      ),
      false,
    );
  }

  for (const label of [
    "shortcutFreeMove",
    "shortcutNudge",
    "shortcutNudgeLarge",
  ]) {
    const localizedShortcut = structuredClone(init);
    localizedShortcut.payload.labels[label] = "Localized movement help";
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        localizedShortcut,
        "tab-9:canvas-a",
      ),
      true,
      `${label} remains optional but accepts localized text`,
    );
    localizedShortcut.payload.labels[label] = 42;
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        localizedShortcut,
        "tab-9:canvas-a",
      ),
      false,
      `${label} rejects invalid wire values`,
    );
  }

  const missingLabel = structuredClone(init);
  delete missingLabel.payload.labels.selection;
  assert.equal(
    isParentToWhiteboardMessageForChannel(missingLabel, "tab-9:canvas-a"),
    false,
  );
  const extraLabel = structuredClone(init);
  extraLabel.payload.labels.rawHostDiagnostic = "must not cross";
  assert.equal(
    isParentToWhiteboardMessageForChannel(extraLabel, "tab-9:canvas-a"),
    false,
  );
  const malformedAnnotations = structuredClone(init);
  malformedAnnotations.payload.labels.annotations = {
    one: "annotation",
    other: "annotations",
    extra: "forged",
  };
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      malformedAnnotations,
      "tab-9:canvas-a",
    ),
    false,
  );

  const repairedCanvas = {
    ...init,
    payload: {
      ...init.payload,
      snapshot: {
        ...emptyDocument,
        nodes: [{ kind: "literature", source: literatureSource }],
      },
    },
  };
  assert.equal(
    isParentToWhiteboardMessageForChannel(repairedCanvas, "tab-9:canvas-a"),
    false,
  );
  const extraCanvasKey = {
    ...init,
    payload: {
      ...init.payload,
      snapshot: { ...emptyDocument, raw: "forged" },
    },
  };
  assert.equal(
    isParentToWhiteboardMessageForChannel(extraCanvasKey, "tab-9:canvas-a"),
    false,
  );

  const explicitUndefinedExtensions = {
    ...init,
    payload: {
      ...init.payload,
      snapshot: {
        ...emptyDocument,
        extensions: {
          omittedByJsonObjects: undefined,
          arrayPosition: [undefined],
        },
      },
    },
  };
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      explicitUndefinedExtensions,
      "tab-9:canvas-a",
    ),
    true,
    "canonical extension undefined values must compare consistently",
  );
});

test("closed validators exhaust finite codes, commands, states, and numeric ranges", () => {
  const requestFailure = activeHostToIframeMessages.find(
    (message) => message.type === "academicRequestFailed",
  )!;
  for (const code of [
    "picker-cancelled",
    "picker-failed",
    "acquisition-failed",
    "library-missing",
    "item-missing",
    "wrong-kind",
    "parent-mismatch",
    "note-refresh-failed",
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...requestFailure,
          payload: { ...requestFailure.payload, code },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const acquisitionBatch = activeHostToIframeMessages.find(
    (message) => message.type === "academicSourcesAcquired",
  )!;
  for (const code of [
    "item-missing",
    "unsupported-attachment",
    "unsupported-kind",
    "acquisition-failed",
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...acquisitionBatch,
          payload: {
            ...acquisitionBatch.payload,
            failures: [{ index: 0, code, message: "Unavailable" }],
          },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const resolutionBatch = activeHostToIframeMessages.find(
    (message) => message.type === "sourceResolutionBatch",
  )!;
  for (const code of [
    "library-missing",
    "item-missing",
    "wrong-kind",
    "parent-mismatch",
    "resolution-failed",
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...resolutionBatch,
          payload: {
            ...resolutionBatch.payload,
            results: [
              {
                nodeId: "node-1",
                generation: 2,
                status: "unavailable",
                code,
                message: "Unavailable",
              },
            ],
          },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const annotationBatch = activeHostToIframeMessages.find(
    (message) => message.type === "annotationsListed",
  )!;
  for (const code of [
    "library-missing",
    "item-missing",
    "wrong-kind",
    "parent-mismatch",
    "attachment-unavailable",
    "annotation-unavailable",
    "list-failed",
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...annotationBatch,
          payload: {
            ...annotationBatch.payload,
            failures: [{ code, message: "Unavailable" }],
          },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const dropRejected = activeHostToIframeMessages.find(
    (message) => message.type === "academicDropRejected",
  )!;
  for (const code of ["drop-malformed", "drop-unsupported"]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        { ...dropRejected, payload: { code } },
        "tab-9:canvas-a",
      ),
      true,
    );
  }
  assert.equal(
    isParentToWhiteboardMessageForChannel(
      {
        ...requestFailure,
        payload: { ...requestFailure.payload, code: "raw-host-error" },
      },
      "tab-9:canvas-a",
    ),
    false,
  );

  const sourceFailure = activeHostToIframeMessages.find(
    (message) => message.type === "sourceActionFailed",
  )!;
  for (const code of [
    "library-missing",
    "item-missing",
    "wrong-kind",
    "parent-mismatch",
    "open-failed",
  ]) {
    assert.equal(
      isParentToWhiteboardMessageForChannel(
        {
          ...sourceFailure,
          payload: {
            ...sourceFailure.payload,
            failure: { code, message: "Unavailable" },
          },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const exportMessage = activeIframeToHostMessages.find(
    (message) => message.type === "exportFile",
  )!;
  for (const format of ["png", "svg", "md"]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        {
          ...exportMessage,
          payload: { ...exportMessage.payload, format },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }

  const resolveMessage = activeIframeToHostMessages.find(
    (message) => message.type === "resolveAcademicSources",
  )!;
  for (const priority of ["selected", "visible", "idle"]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        {
          ...resolveMessage,
          payload: { ...resolveMessage.payload, priority },
        },
        "tab-9:canvas-a",
      ),
      true,
    );
  }
  for (const generation of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        {
          ...resolveMessage,
          payload: { ...resolveMessage.payload, generation },
        },
        "tab-9:canvas-a",
      ),
      false,
    );
  }

  const openItem = activeIframeToHostMessages.find(
    (message) => message.type === "openItem",
  )!;
  for (const itemID of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      isWhiteboardToParentMessageForChannel(
        { ...openItem, payload: { ...openItem.payload, itemID } },
        "tab-9:canvas-a",
      ),
      false,
    );
  }
});

test("protocol source uses CanvasDocument and contains no retired v1 picker arms", () => {
  const source = readFileSync(
    new URL("../packages/whiteboard/src/model/protocol.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /BasicPickerPayload/);
  for (const retiredType of [
    "itemPicked",
    "pickFailed",
    "pickItem",
    "dropItems",
  ]) {
    assert.doesNotMatch(source, new RegExp(`type: "${retiredType}"`));
  }
  assert.match(source, /snapshot\?: CanvasDocument \| null/);
  assert.match(source, /priority: SourceResolutionPriority/);
  assert.doesNotMatch(source, /noteID/);
  const academicDrop = source.slice(
    source.indexOf('type: "dropAcademicSources"'),
    source.indexOf('type: "resolveAcademicSources"'),
  );
  assert.match(academicDrop, /sources:\s*AcademicDropSourceRef\[\]/);
  assert.doesNotMatch(academicDrop, /Record<string, string>|\braw\b|itemID/);
  const hostAcademicDrop = source.slice(
    source.indexOf('type: "academicDropStarted"'),
    source.indexOf('type: "academicDropRejected"'),
  );
  assert.match(hostAcademicDrop, /sources:\s*AcademicDropSourceRef\[\]/);
  assert.doesNotMatch(
    hostAcademicDrop,
    /Record<string, string>|\braw\b|itemID/,
  );
  const sourceActionSuccess = source.slice(
    source.indexOf('type: "sourceActionSucceeded"'),
    source.indexOf('type: "saveState"'),
  );
  assert.match(sourceActionSuccess, /source: AcademicSourceDescriptor/);
  const sourceActionFailure = source.slice(
    source.indexOf('type: "sourceActionFailed"'),
    source.indexOf('type: "sourceActionSucceeded"'),
  );
  assert.match(sourceActionFailure, /source: AcademicSourceDescriptor/);
});

test("tab refocus sends a versioned protocol message", () => {
  const hooks = readFileSync(
    new URL("../src/modules/whiteboard/tabHooks.ts", import.meta.url),
    "utf8",
  );
  assert.match(hooks, /WHITEBOARD_PROTOCOL_VERSION/);
  assert.match(
    hooks,
    /channel: `\$\{tab\.id\}:\$\{tab\.data\?\.canvasId \?\? ""\}`,[\s\S]*v: WHITEBOARD_PROTOCOL_VERSION,[\s\S]*type: "focus"/,
  );
});

test("color schemes accept known values only on init and updates", () => {
  for (const value of ["traditional", "classic", "unknown", null, 1, {}]) {
    const expected = value === "traditional" || value === "classic";
    for (const type of ["init", "setColorScheme"]) {
      const payload =
        type === "init"
          ? { theme: "light", colorScheme: value }
          : { colorScheme: value };
      assert.equal(
        isParentToWhiteboardMessageForChannel(
          { ...protocolBase, type, payload },
          "tab-9:canvas-a",
        ),
        expected,
      );
    }
  }
});
