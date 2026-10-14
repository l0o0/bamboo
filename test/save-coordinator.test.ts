import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SaveCoordinator", () => {
  it("does not drop a second request that arrives while writing", async () => {
    const values: string[] = [];
    const firstWrite = deferred<void>();
    let writes = 0;
    let latest = "rev0";
    const save = new SaveCoordinator({
      getSnapshot: () => ({ rev: save.currentRev, value: latest }),
      write: async (value) => {
        writes += 1;
        values.push(value);
        if (writes === 1) await firstWrite.promise;
      },
    });

    save.markChanged();
    latest = "rev1";
    const first = save.request();
    await Promise.resolve();
    save.markChanged();
    latest = "rev2";
    const second = save.request();
    firstWrite.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(values, ["rev1", "rev2"]);
    assert.equal(save.savedRev, save.currentRev);
    assert.equal(save.dirty, false);
  });

  it("rewrites after a successful save if the document changed during I/O", async () => {
    const values: string[] = [];
    const firstWrite = deferred<void>();
    let writes = 0;
    let latest = "a";
    const save = new SaveCoordinator({
      getSnapshot: () => ({ rev: save.currentRev, value: latest }),
      write: async (value) => {
        writes += 1;
        values.push(value);
        if (writes === 1) {
          save.markChanged();
          latest = "b";
          await firstWrite.promise;
        }
      },
    });

    save.markChanged();
    const done = save.request();
    firstWrite.resolve();
    await done;

    assert.deepEqual(values, ["a", "b"]);
    assert.equal(save.dirty, false);
  });

  it("skips idle autosave when the document is clean", async () => {
    let writes = 0;
    const save = new SaveCoordinator({
      getSnapshot: () => ({ rev: save.currentRev, value: "x" }),
      write: async () => {
        writes += 1;
      },
    });
    await save.request();
    assert.equal(writes, 0);
    await save.request({ force: true });
    assert.equal(writes, 1);
  });

  it("keeps the document dirty when a write fails", async () => {
    const save = new SaveCoordinator({
      getSnapshot: () => ({ rev: save.currentRev, value: "x" }),
      write: async () => {
        throw new Error("disk full");
      },
    });
    save.markChanged();
    await assert.rejects(() => save.request(), /disk full/);
    assert.equal(save.dirty, true);
    assert.equal(save.lastError?.message, "disk full");
  });

  it("adopts externally persisted content as clean without writing", async () => {
    let writes = 0;
    const save = new SaveCoordinator({
      getSnapshot: () => ({ rev: save.currentRev, value: "external" }),
      write: async () => {
        writes += 1;
      },
    });

    save.markChanged();
    const previousRevision = save.currentRev;
    save.adoptPersistedSnapshot();

    assert.equal(save.currentRev, previousRevision + 1);
    assert.equal(save.savedRev, save.currentRev);
    assert.equal(save.dirty, false);
    assert.equal(save.lastError, null);
    assert.equal(writes, 0);
  });

  it("rechecks a paused snapshot and retains a queued force request without leaving either promise pending", async () => {
    let allowed = true;
    const snapshot = deferred<{ rev: number; value: string }>();
    let pendingSnapshot: typeof snapshot | undefined = snapshot;
    const started = deferred<void>();
    let snapshots = 0;
    const writes: Array<{
      value: string;
      force: boolean;
      cleanupImages: boolean;
    }> = [];
    const save = new SaveCoordinator({
      canAutosave: () => allowed,
      getSnapshot: () => {
        snapshots++;
        if (pendingSnapshot) {
          const next = pendingSnapshot;
          pendingSnapshot = undefined;
          started.resolve();
          return next.promise;
        }
        return { rev: save.currentRev, value: "forced current draft" };
      },
      write: async (value, request) => {
        writes.push({ value, ...request });
      },
    });
    save.markChanged();
    const automatic = save.request({ cleanupImages: true });
    await started.promise;
    allowed = false;
    snapshot.resolve({ rev: save.currentRev, value: "unfinished candidate" });
    await automatic;
    assert.deepEqual(writes, []);
    assert.equal(save.dirty, true);
    assert.equal(save.writing, false);
    assert.equal(save.lastError, null);
    await save.request(); // Already-paused requests also settle immediately.
    assert.equal(snapshots, 1);
    await save.request({ force: true });
    assert.deepEqual(writes, [
      { value: "forced current draft", force: true, cleanupImages: true },
    ]);
    assert.equal(save.dirty, false);

    save.markChanged();
    await save.request();
    assert.equal(writes.length, 1);
    allowed = true;
    await save.request();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].force, false);
    assert.equal(save.dirty, false);

    const secondSnapshot = deferred<{ rev: number; value: string }>();
    pendingSnapshot = secondSnapshot;
    save.markChanged();
    const secondAutomatic = save.request({ cleanupImages: true });
    await Promise.resolve();
    allowed = false;
    const queuedForce = save.request({ force: true });
    secondSnapshot.resolve({
      rev: save.currentRev,
      value: "another candidate",
    });
    await Promise.all([secondAutomatic, queuedForce]);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[2], {
      value: "forced current draft",
      force: true,
      cleanupImages: true,
    });
    assert.equal(save.dirty, false);
  });
});
