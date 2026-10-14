import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { flushMarkdownItems } from "../src/modules/markdown/tab.ts";
import {
  sessionRegistry,
  type OpenSession,
} from "../src/modules/markdown/session-registry.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";
import { SidebarControllerRegistry } from "../src/modules/markdown/sidebar-state.ts";

let sequence = 0;
const registered: string[] = [];
afterEach(() => {
  for (const id of registered.splice(0)) sessionRegistry.unregister(id);
});
function surface(itemID: number, initialDirty = false, registerTab = true) {
  const state = {
    snapshots: 0,
    writes: 0,
    composing: false,
    onSnapshot: () => {},
    onWrite: async () => {},
    fail: false,
  };
  const save = new SaveCoordinator({
    canAutosave: () => !state.composing,
    getSnapshot: () => ({ rev: save.currentRev, value: "latest draft" }),
    write: async () => {
      if (state.fail) throw new Error("disk full");
      await state.onWrite();
      state.writes++;
    },
  });
  if (initialDirty) save.markChanged();
  const tabID = `export-flush-${++sequence}`;
  const editor = {
    isComposing: () => state.composing,
    requestSnapshot: async () => {
      state.snapshots++;
      state.onSnapshot();
      return "latest draft";
    },
  };
  if (registerTab) {
    sessionRegistry.register({
      tabID,
      itemID,
      win: {},
      surface: "tab",
      save,
      editor,
    } as unknown as OpenSession);
    registered.push(tabID);
  }
  return { state, save, editor };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("selected-note export saves the draft and leaves unrelated and clean peers alone", async () => {
  const draft = surface(1, true);
  const stale = surface(1);
  const unrelated = surface(2, true);
  await flushMarkdownItems([1, 1]);
  assert.equal(draft.state.writes, 1);
  assert.equal(stale.state.writes, 0);
  assert.equal(unrelated.state.snapshots, 0);
  assert.equal(unrelated.save.dirty, true);
});

test("snapshot discovers pending table cell changes before exporting", async () => {
  const note = surface(1);
  note.state.onSnapshot = () => note.save.markChanged();
  await flushMarkdownItems([1]);
  assert.equal(note.state.writes, 1);
  assert.equal(note.save.dirty, false);
});

test("competing drafts stop export without writing either version", async () => {
  const first = surface(1, true);
  const second = surface(1, true);
  await assert.rejects(flushMarkdownItems([1]), /note-export-conflict/);
  assert.equal(first.state.writes + second.state.writes, 0);
});

test("active composition is not snapshotted for export", async () => {
  const note = surface(1, true);
  note.state.composing = true;
  await assert.rejects(flushMarkdownItems([1]), /note-export-composing/);
  assert.equal(note.state.snapshots, 0);
  assert.equal(note.state.writes, 0);
});

test("composition starting while snapshotting aborts export", async () => {
  const note = surface(1, true);
  note.state.onSnapshot = () => {
    note.state.composing = true;
  };
  await assert.rejects(flushMarkdownItems([1]), /note-export-composing/);
  assert.equal(note.state.writes, 0);
});

test("failed draft saves are propagated so stale files are not exported", async () => {
  const note = surface(1, true);
  note.state.fail = true;
  await assert.rejects(flushMarkdownItems([1]), /disk full/);
  assert.equal(note.save.dirty, true);
});

test(
  "export waits for an already writing clean revision without duplicating its forced save",
  { timeout: 5000 },
  async (t) => {
    const note = surface(1);
    const entered = deferred();
    const release = deferred();
    const snapshotted = deferred();
    t.after(release.resolve);
    note.state.onWrite = async () => {
      entered.resolve();
      await release.promise;
    };
    note.state.onSnapshot = snapshotted.resolve;
    const writing = note.save.request({ force: true });
    await entered.promise;
    assert.equal(note.save.writing, true);
    assert.equal(
      note.save.dirty,
      false,
      "the writing flag alone must keep export waiting",
    );
    let completed = false;
    const exporting = flushMarkdownItems([1]);
    void exporting.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await snapshotted.promise;
    await nextTurn();
    assert.equal(completed, false);
    assert.equal(note.state.writes, 0);
    release.resolve();
    await Promise.all([writing, exporting]);
    assert.equal(note.state.writes, 1);
    assert.equal(note.save.writing, false);
  },
);

test(
  "a peer becoming dirty while export awaits another save aborts instead of exporting stale files",
  { timeout: 5000 },
  async (t) => {
    const draft = surface(1, true);
    const peer = surface(1);
    const entered = deferred();
    const release = deferred();
    t.after(release.resolve);
    draft.state.onWrite = async () => {
      entered.resolve();
      await release.promise;
    };
    const exporting = flushMarkdownItems([1]);
    const rejected = assert.rejects(exporting, /note-export-conflict/);
    await entered.promise;
    assert.equal(peer.state.snapshots, 1);
    peer.save.markChanged();
    release.resolve();
    await rejected;
    assert.equal(draft.state.writes, 1);
    assert.equal(draft.save.dirty, false);
    assert.equal(
      peer.state.writes,
      0,
      "a new competing draft must not be force-saved",
    );
    assert.equal(peer.save.dirty, true);
  },
);

for (const sameSurface of [false, true]) {
  test(
    `composition beginning in ${sameSurface ? "the writing surface" : "another peer"} while export awaits I/O aborts with the candidate unsaved`,
    { timeout: 5000 },
    async (t) => {
      const draft = surface(1, true);
      const composing = sameSurface ? draft : surface(1);
      const entered = deferred();
      const release = deferred();
      t.after(release.resolve);
      draft.state.onWrite = async () => {
        entered.resolve();
        await release.promise;
      };
      const exporting = flushMarkdownItems([1]);
      const rejected = assert.rejects(exporting, /note-export-conflict/);
      await entered.promise;
      composing.state.composing = true;
      composing.save.markChanged();
      release.resolve();
      await rejected;
      assert.equal(
        draft.state.writes,
        1,
        "only the confirmed revision already in flight completes",
      );
      assert.equal(composing.save.dirty, true);
      if (!sameSurface) assert.equal(composing.state.writes, 0);
    },
  );
}

test("sidebar sessions participate in selected-note flush and conflict checks alongside tabs", async (t) => {
  const tab = surface(1);
  const sidebar = surface(1, true, false);
  const unrelated = surface(2, true, false);
  // Exercise the real findSidebarSessions lookup without mounting an iframe.
  t.mock.method(SidebarControllerRegistry.prototype, "all", () => [
    { currentItemID: 1, getSession: () => sidebar },
    { currentItemID: 2, getSession: () => unrelated },
  ]);
  await flushMarkdownItems([1]);
  assert.equal(sidebar.state.snapshots, 1);
  assert.equal(sidebar.state.writes, 1);
  assert.equal(tab.state.writes, 0);
  assert.equal(unrelated.state.snapshots, 0);
  assert.equal(unrelated.save.dirty, true);
  sidebar.state.composing = true;
  await assert.rejects(flushMarkdownItems([1]), /note-export-composing/);
  assert.equal(sidebar.state.snapshots, 1);
  sidebar.state.composing = false;
  sidebar.save.markChanged();
  tab.save.markChanged();
  await assert.rejects(flushMarkdownItems([1]), /note-export-conflict/);
  assert.equal(sidebar.state.writes, 1);
  assert.equal(tab.state.writes, 0);
});
