import assert from "node:assert/strict";
import test from "node:test";
import {
  createAcademicNode,
  getNoteType,
  noteReferenceHref,
  type NoteNode,
  type QuoteNode,
} from "../packages/whiteboard/src/model/academic.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import {
  createConnectedNote,
  createNoteFromQuote,
  type ConnectedNoteOptions,
} from "../packages/whiteboard/src/whiteboard/continuation.ts";

const options: ConnectedNoteOptions = {
  originId: "origin",
  nodeId: "continued",
  edgeId: "continued-edge",
  position: { x: 400, y: 0 },
};

function documentWithOrigin(): CanvasDocument {
  return {
    version: 2,
    nodes: [createAcademicNode("note", { x: 0, y: 0 }, "origin")],
    connections: [],
  };
}

function quoteDocument(): CanvasDocument {
  return {
    version: 2,
    nodes: [
      createAcademicNode("quote", { x: 0, y: 0 }, "origin", {
        source: {
          library: { type: "group", groupID: 41 },
          itemKey: "ITEM1234",
          attachmentKey: "PDF12345",
          annotationKey: "ANNO1234",
        },
        snapshot: {
          text: "A quotation worth considering.",
          comment: "My annotation",
          citation: "Smith, 2026, p. 5",
          pageLabel: "5",
        },
      }),
    ],
    connections: [],
  };
}

function addedNote(document: CanvasDocument): NoteNode {
  const note = document.nodes.find((node) => node.id === options.nodeId);
  assert.equal(note?.kind, "note");
  return note as NoteNode;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("continuation adds a blank note and one ordinary connection in one result", () => {
  const document = documentWithOrigin();
  const result = createConnectedNote(document, options)!;

  assert.equal(result.noteId, "continued");
  assert.equal(result.document.nodes.length, 2);
  assert.equal(result.document.connections.length, 1);
  assert.deepEqual(addedNote(result.document), {
    id: "continued",
    kind: "note",
    position: { x: 400, y: 0 },
    width: 260,
    height: 152,
    content: "",
  });
  assert.deepEqual(result.document.connections[0], {
    id: "continued-edge",
    kind: "basic",
    source: "origin",
    target: "continued",
    sourceHandle: "right",
    targetHandle: "left",
  });
  assert.equal(document.nodes.length, 1);
  assert.deepEqual(document.connections, []);
});

for (const { position, originHandle, noteHandle } of [
  { position: { x: 400, y: 0 }, originHandle: "right", noteHandle: "left" },
  { position: { x: -400, y: 0 }, originHandle: "left", noteHandle: "right" },
  { position: { x: 0, y: 400 }, originHandle: "bottom", noteHandle: "top" },
  { position: { x: 0, y: -400 }, originHandle: "top", noteHandle: "bottom" },
]) {
  test(`continuation faces the origin when placed on its ${originHandle}`, () => {
    const document = documentWithOrigin();
    const forward = createConnectedNote(document, { ...options, position })!;
    assert.equal(forward.document.connections[0].sourceHandle, originHandle);
    assert.equal(forward.document.connections[0].targetHandle, noteHandle);

    const reverse = createConnectedNote(document, {
      ...options,
      position,
      handleType: "target",
    })!;
    assert.equal(reverse.document.connections[0].source, "continued");
    assert.equal(reverse.document.connections[0].target, "origin");
    assert.equal(reverse.document.connections[0].sourceHandle, noteHandle);
    assert.equal(reverse.document.connections[0].targetHandle, originHandle);
  });
}

test("handle choice uses node centers rather than their top-left positions", () => {
  const document = documentWithOrigin();
  document.nodes[0] = {
    ...document.nodes[0],
    width: 1000,
    height: 152,
  };
  const result = createConnectedNote(document, {
    ...options,
    position: { x: 350, y: 0 },
  })!;
  assert.equal(result.document.connections[0].targetHandle, "right");
  assert.equal(result.document.connections[0].sourceHandle, "left");
});

test("dragged handle ids, including null, are preserved in either direction", () => {
  for (const handleId of ["bottom", "custom-output", "", null]) {
    for (const handleType of ["source", "target"] as const) {
      const result = createConnectedNote(documentWithOrigin(), {
        ...options,
        handleId,
        handleType,
      })!;
      const edge = result.document.connections[0];
      assert.equal(
        handleType === "source" ? edge.sourceHandle : edge.targetHandle,
        handleId,
      );
      assert.equal(
        handleType === "source" ? edge.targetHandle : edge.sourceHandle,
        "left",
      );
    }
  }
});

test("typed continuations keep blank content and avoid inferred academic relations", () => {
  for (const noteType of [
    "note",
    "question",
    "claim",
    "evidence",
    "summary",
  ] as const) {
    const result = createConnectedNote(documentWithOrigin(), {
      ...options,
      noteType,
    })!;
    const note = addedNote(result.document);
    assert.equal(getNoteType(note), noteType);
    assert.equal(note.content, "");
    assert.equal(result.document.connections[0].kind, "basic");
    assert.equal("relation" in result.document.connections[0], false);
  }
});

test("continuation preserves existing objects and document metadata without inheriting a frame", () => {
  const document = documentWithOrigin();
  document.nodes[0] = {
    ...(document.nodes[0] as NoteNode),
    frameId: "frame",
    style: { fill: "#fece4e" },
    extensions: { own: [1, 2] },
  };
  document.nodes.push(createAcademicNode("frame", { x: -20, y: -20 }, "frame"));
  document.connections.push({
    id: "existing-edge",
    kind: "basic",
    source: "origin",
    target: "frame",
    extensions: { custom: true },
  });
  document.metadata = { title: "Research", createdAt: "2026-09-22" };
  document.viewport = { x: 30, y: 40, zoom: 0.7 };
  document.extensions = { custom: { version: 4 } };
  const before = structuredClone(document);
  deepFreeze(document);
  const result = createConnectedNote(document, options)!;

  assert.notEqual(result.document, document);
  assert.notEqual(result.document.nodes, document.nodes);
  assert.notEqual(result.document.connections, document.connections);
  assert.equal(result.document.nodes[0], document.nodes[0]);
  assert.equal(result.document.nodes[1], document.nodes[1]);
  assert.equal(result.document.connections[0], document.connections[0]);
  assert.equal(result.document.metadata, document.metadata);
  assert.equal(result.document.viewport, document.viewport);
  assert.equal(result.document.extensions, document.extensions);
  assert.equal(addedNote(result.document).frameId, undefined);
  assert.deepEqual(document, before);

  const mutablePosition = { x: 800, y: 200 };
  const second = createConnectedNote(document, {
    ...options,
    position: mutablePosition,
  })!;
  mutablePosition.x = 99;
  assert.equal(addedNote(second.document).position.x, 800);
});

test("invalid continuations return null without modifying the document", () => {
  const document = documentWithOrigin();
  document.nodes.push(createAcademicNode("frame", { x: 0, y: 0 }, "frame"));
  document.connections.push({
    id: "existing-edge",
    kind: "basic",
    source: "origin",
    target: "frame",
  });
  const before = structuredClone(document);
  deepFreeze(document);
  const invalidOptions: Partial<ConnectedNoteOptions>[] = [
    { originId: "absent" },
    { originId: "frame" },
    { nodeId: "origin" },
    { edgeId: "origin" },
    { nodeId: "existing-edge" },
    { edgeId: "existing-edge" },
    { edgeId: "continued" },
    { nodeId: "" },
    { edgeId: "" },
    { position: { x: Number.NaN, y: 10 } },
    { position: { x: 0, y: Infinity } },
    { position: { x: -Infinity, y: 0 } },
    { noteType: "unsupported" as ConnectedNoteOptions["noteType"] },
    { handleType: "unsupported" as ConnectedNoteOptions["handleType"] },
    { handleId: 3 as unknown as string },
  ];
  for (const invalid of invalidOptions) {
    assert.equal(
      createConnectedNote(document, { ...options, ...invalid }),
      null,
    );
    assert.deepEqual(document, before);
  }
});

test("quote creates a blank viewpoint or evidence card with a Zotero literature reference", () => {
  const document = deepFreeze(quoteDocument());
  for (const noteType of ["claim", "evidence"] as const) {
    const result = createNoteFromQuote(document, { ...options, noteType })!;
    const note = addedNote(result.document);
    assert.equal(note.noteType, noteType);
    assert.equal(note.content, "");
    assert.deepEqual(note.references, [
      {
        id: "reference-continued",
        kind: "literature",
        source: {
          library: { type: "group", groupID: 41 },
          itemKey: "ITEM1234",
        },
        title: "Smith, 2026, p. 5",
      },
    ]);
    assert.equal(
      noteReferenceHref(note.references![0]),
      "zotero://select/groups/41/items/ITEM1234",
    );
    assert.equal(result.document.nodes[0], document.nodes[0]);
    assert.equal(result.document.connections[0].kind, "basic");
    assert.equal("source" in note, false);
    assert.equal("annotationKey" in note.references![0].source, false);
    assert.notEqual(
      note.references![0].source.library,
      (document.nodes[0] as QuoteNode).source.library,
    );
  }
});

test("quote reference uses matching literature metadata across library identities", () => {
  const document = quoteDocument();
  document.nodes.push(
    createAcademicNode("literature", { x: 0, y: 300 }, "wrong-library", {
      source: { library: { type: "user" }, itemKey: "ITEM1234" },
      snapshot: { title: "Wrong source" },
    }),
    createAcademicNode("literature", { x: 300, y: 300 }, "same-paper", {
      source: { library: { type: "group", groupID: 41 }, itemKey: "ITEM1234" },
      snapshot: {
        title: "Actual paper",
        creators: "Smith and Doe",
        year: "2026",
      },
    }),
  );
  const result = createNoteFromQuote(deepFreeze(document), {
    ...options,
    noteType: "claim",
  })!;
  const reference = addedNote(result.document).references![0];
  assert.equal(reference.title, "Actual paper");
  assert.equal(reference.creators, "Smith and Doe");
  assert.equal(reference.year, "2026");
  assert.equal(
    noteReferenceHref(reference),
    "zotero://select/groups/41/items/ITEM1234",
  );
});

test("quote reference falls back to the item key and bounds the display title", () => {
  const document = quoteDocument();
  const quote = document.nodes[0] as QuoteNode;
  quote.snapshot.citation = "";
  quote.source.library = { type: "user" };
  const fallback = createNoteFromQuote(document, {
    ...options,
    noteType: "evidence",
  })!;
  const fallbackReference = addedNote(fallback.document).references![0];
  assert.equal(fallbackReference.title, "ITEM1234");
  assert.equal(
    noteReferenceHref(fallbackReference),
    "zotero://select/library/items/ITEM1234",
  );

  quote.snapshot.citation = "x".repeat(5000);
  const long = createNoteFromQuote(document, {
    ...options,
    noteType: "evidence",
  })!;
  assert.equal(addedNote(long.document).references![0].title.length, 4096);
  assert.equal(quote.snapshot.citation.length, 5000);
});

test("quote creation rejects non-quotes and unsupported note types without mutation", () => {
  const document = deepFreeze(quoteDocument());
  const before = structuredClone(document);
  assert.equal(
    createNoteFromQuote(document, {
      ...options,
      originId: "absent",
      noteType: "claim",
    }),
    null,
  );
  assert.equal(
    createNoteFromQuote(documentWithOrigin(), {
      ...options,
      noteType: "claim",
    }),
    null,
  );
  assert.equal(
    createNoteFromQuote(document, { ...options, noteType: "note" as "claim" }),
    null,
  );
  assert.equal(
    createNoteFromQuote(document, {
      ...options,
      edgeId: "origin",
      noteType: "claim",
    }),
    null,
  );
  assert.deepEqual(document, before);
});

test("quote continuation and Zotero reference survive file save and reopen", () => {
  const result = createNoteFromQuote(quoteDocument(), {
    ...options,
    noteType: "evidence",
  })!;
  const reopened = canvasFileToDocument(canvasDocumentToFile(result.document));
  assert.deepEqual(reopened.issues, []);
  assert.deepEqual(reopened.document.nodes, result.document.nodes);
  assert.deepEqual(reopened.document.connections, result.document.connections);
  assert.equal(
    noteReferenceHref(addedNote(reopened.document).references![0]),
    "zotero://select/groups/41/items/ITEM1234",
  );
});
