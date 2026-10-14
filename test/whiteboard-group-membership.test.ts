import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createAcademicNode,
  type CanvasNode,
  type FrameNode,
  type NoteNode,
} from "../packages/whiteboard/src/model/academic.ts";
import {
  canvasDocumentToFile,
  canvasFileToDocument,
} from "../packages/whiteboard/src/model/canvas-file.ts";
import type { CanvasDocument } from "../packages/whiteboard/src/model/document.ts";
import { joinFrame } from "../packages/whiteboard/src/whiteboard/groupMembership.ts";
import {
  useCanvasDocumentRuntime,
  type CanvasDocumentRuntime,
} from "../packages/whiteboard/src/whiteboard/runtime.ts";

function fixture(): CanvasDocument {
  return {
    version: 2,
    nodes: [
      createAcademicNode("frame", { x: 0, y: 0 }, "topic-a"),
      createAcademicNode("frame", { x: 600, y: 0 }, "topic-b"),
      {
        ...createAcademicNode("note", { x: 80, y: 80 }, "member", {
          content: "Already in the topic",
          width: 120,
          height: 80,
        }),
        frameId: "topic-a",
      },
      createAcademicNode("note", { x: 40, y: 100 }, "overlap", {
        content: "Overlap alone does not assign membership",
        width: 120,
        height: 80,
        style: { fill: "#fff3a2" },
      }),
      {
        ...createAcademicNode("note", { x: 660, y: 80 }, "transfer", {
          noteType: "claim",
          content: "Keep my position and writing",
          width: 120,
          height: 80,
        }),
        frameId: "topic-b",
        extensions: { retained: true },
      },
      createAcademicNode("note", { x: -100, y: -40 }, "outside", {
        width: 100,
        height: 70,
      }),
      createAcademicNode("quote", { x: 800, y: 400 }, "quote", {
        source: {
          library: { type: "user" },
          itemKey: "ITEM1234",
          attachmentKey: "ATT12345",
          annotationKey: "ANNO1234",
        },
        snapshot: { text: "Keep this quotation and its source" },
      }),
    ],
    connections: [
      {
        id: "edge",
        kind: "basic",
        source: "overlap",
        target: "transfer",
        sourceHandle: "right",
        targetHandle: "left",
        extensions: { retained: "edge" },
      },
    ],
    viewport: { x: 20, y: -10, zoom: 0.75 },
    metadata: { title: "Research topics", createdAt: "2026-09-22" },
    extensions: { retained: { version: 3 } },
  };
}

function node(document: CanvasDocument, id: string): CanvasNode {
  const value = document.nodes.find((candidate) => candidate.id === id);
  assert.ok(value, `Missing fixture node ${id}`);
  return value;
}

function frame(document: CanvasDocument, id: string): FrameNode {
  const value = node(document, id);
  assert.equal(value.kind, "frame");
  return value as FrameNode;
}

function frameId(document: CanvasDocument, id: string): string | undefined {
  const value = node(document, id);
  return value.kind === "frame" ? undefined : value.frameId;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("explicit join assigns an overlapping card while preserving edges and unrelated objects", () => {
  const original = deepFreeze(fixture());
  const before = structuredClone(original);
  assert.equal(frameId(original, "overlap"), undefined);
  const joined = joinFrame(original, ["overlap"], "topic-a");

  assert.notEqual(joined, original);
  assert.equal(frameId(joined, "overlap"), "topic-a");
  assert.notEqual(node(joined, "overlap"), node(original, "overlap"));
  assert.equal(
    node(joined, "overlap").position,
    node(original, "overlap").position,
  );
  assert.equal(node(joined, "overlap").style, node(original, "overlap").style);
  assert.deepEqual(frame(joined, "topic-a"), frame(original, "topic-a"));
  for (const id of ["topic-b", "member", "transfer", "outside", "quote"]) {
    assert.equal(node(joined, id), node(original, id));
  }
  assert.equal(joined.connections, original.connections);
  assert.equal(joined.connections[0], original.connections[0]);
  assert.equal(joined.metadata, original.metadata);
  assert.equal(joined.viewport, original.viewport);
  assert.equal(joined.extensions, original.extensions);
  assert.deepEqual(original, before);
});

test("transferring membership leaves the card and previous frame in place", () => {
  const original = deepFreeze(fixture());
  const joined = joinFrame(original, ["transfer"], "topic-a");
  const transferred = node(joined, "transfer") as NoteNode;
  const previous = node(original, "transfer") as NoteNode;

  assert.equal(transferred.frameId, "topic-a");
  assert.deepEqual(transferred, { ...previous, frameId: "topic-a" });
  assert.equal(transferred.position, previous.position);
  assert.equal(transferred.extensions, previous.extensions);
  assert.equal(frame(joined, "topic-b"), frame(original, "topic-b"));
  assert.deepEqual(frame(joined, "topic-a").position, { x: 0, y: 0 });
  assert.equal(frame(joined, "topic-a").width, 812);
  assert.equal(frame(joined, "topic-a").height, 320);
  assert.equal(frameId(original, "transfer"), "topic-b");
});

test("mixed batch skips frames and missing ids, keeps cards in place, and expands the target bounds", () => {
  const original = deepFreeze(fixture());
  const joined = joinFrame(
    original,
    ["topic-a", "topic-b", "member", "outside", "quote", "outside", "missing"],
    "topic-a",
  );

  assert.equal(joined.nodes.length, original.nodes.length);
  assert.equal(frameId(joined, "outside"), "topic-a");
  assert.equal(frameId(joined, "quote"), "topic-a");
  assert.equal(node(joined, "member"), node(original, "member"));
  assert.equal(frame(joined, "topic-b"), frame(original, "topic-b"));
  for (const id of ["topic-a", "topic-b"]) {
    assert.equal("frameId" in node(joined, id), false, "frames cannot nest");
  }
  for (const id of ["outside", "quote"]) {
    assert.equal(node(joined, id).position, node(original, id).position);
    assert.equal(node(joined, id).width, node(original, id).width);
    assert.equal(node(joined, id).height, node(original, id).height);
  }
  const expanded = frame(joined, "topic-a");
  assert.deepEqual(expanded.position, { x: -132, y: -104 });
  assert.equal(expanded.width, 1244);
  assert.equal(expanded.height, 728);
  assert.equal(joined.connections, original.connections);
});

test("same membership, empty selections, invalid ids, and non-frame targets are exact no-ops", () => {
  const original = deepFreeze(fixture());
  const before = structuredClone(original);
  for (const [ids, target] of [
    [["member", "member"], "topic-a"],
    [[], "topic-a"],
    [["missing"], "topic-a"],
    [["topic-a", "topic-b"], "topic-a"],
    [["overlap"], "missing"],
    [["overlap"], ""],
    [["transfer"], "overlap"],
  ] as const) {
    assert.equal(joinFrame(original, ids, target), original);
    assert.deepEqual(original, before);
  }
});

test("joined membership, frame geometry, and content survive file save and reopen", () => {
  const joined = joinFrame(
    fixture(),
    ["outside", "quote", "transfer"],
    "topic-a",
  );
  const savedAt = "2026-10-13T10:24:00.000Z";
  const reopened = canvasFileToDocument(
    canvasDocumentToFile(joined, { now: savedAt }),
  );

  assert.deepEqual(reopened.issues, []);
  assert.deepEqual(reopened.document.nodes, joined.nodes);
  assert.deepEqual(reopened.document.connections, joined.connections);
  assert.deepEqual(reopened.document.metadata, {
    ...joined.metadata,
    updatedAt: savedAt,
  });
  assert.deepEqual(reopened.document.extensions, joined.extensions);
  for (const id of ["outside", "quote", "transfer"]) {
    assert.equal(frameId(reopened.document, id), "topic-a");
  }
});

test("one runtime history entry undoes the entire membership batch and frame expansion", () => {
  let runtime: CanvasDocumentRuntime | undefined;
  const revisions: number[] = [];
  function Harness() {
    runtime = useCanvasDocumentRuntime(
      fixture(),
      (revision) => revisions.push(revision),
      () => {},
    );
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  assert.ok(runtime);
  const before = runtime.getSnapshot();
  const joined = joinFrame(before, ["outside", "quote", "transfer"], "topic-a");
  runtime.pushHistory();
  runtime.applyDocument(joined);
  runtime.changed();
  assert.deepEqual(runtime.getSnapshot(), joined);
  assert.deepEqual(revisions, [1]);

  runtime.undo();
  assert.deepEqual(runtime.getSnapshot(), before);
  assert.equal(frameId(runtime.getSnapshot(), "outside"), undefined);
  assert.equal(frameId(runtime.getSnapshot(), "transfer"), "topic-b");
  assert.equal(runtime.history.undo(runtime.getSnapshot()), undefined);
  runtime.redo();
  assert.deepEqual(runtime.getSnapshot(), joined);
  assert.deepEqual(revisions, [1, 2, 3]);
});
