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
});
