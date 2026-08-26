import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DocumentSyncRegistry,
  type DocumentSyncSource,
} from "../src/modules/markdown/document-sync.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function source(
  overrides: Partial<DocumentSyncSource> & Pick<DocumentSyncSource, "sourceID">,
): DocumentSyncSource {
  return {
    sourceID: overrides.sourceID,
    itemID: overrides.itemID ?? 7,
    hasLocalWork: overrides.hasLocalWork ?? (() => false),
    flush: overrides.flush ?? (async () => undefined),
    getCurrentValue: overrides.getCurrentValue ?? (() => "initial"),
    readPersisted: overrides.readPersisted ?? (async () => "initial"),
    applyPersisted: overrides.applyPersisted ?? (() => undefined),
  };
}

describe("DocumentSyncRegistry", () => {
  it("refreshes a clean source after another source saves", async () => {
    const registry = new DocumentSyncRegistry();
    let sidebarValue = "initial";
    let persisted = "initial";

    registry.register(
      source({
        sourceID: "tab:a",
        getCurrentValue: () => persisted,
      }),
    );
    registry.register(
      source({
        sourceID: "sidebar:a",
        getCurrentValue: () => sidebarValue,
        readPersisted: async () => persisted,
        applyPersisted: (value) => {
          sidebarValue = value;
        },
      }),
    );

    persisted = "saved in tab";
    registry.markSaved("tab:a");

    assert.equal(await registry.refreshOnFocus("sidebar:a"), "refreshed");
    assert.equal(sidebarValue, "saved in tab");
  });

  it("flushes the newest dirty peer before reading persisted content", async () => {
    const registry = new DocumentSyncRegistry();
    const events: string[] = [];
    let tabDirty = true;
    let persisted = "initial";
    let sidebarValue = "initial";

    registry.register(
      source({
        sourceID: "tab:a",
        hasLocalWork: () => tabDirty,
        flush: async () => {
          events.push("flush");
          persisted = "draft from tab";
          tabDirty = false;
          registry.markSaved("tab:a");
        },
      }),
    );
    registry.register(
      source({
        sourceID: "sidebar:a",
        getCurrentValue: () => sidebarValue,
        readPersisted: async () => {
          events.push("read");
          return persisted;
        },
        applyPersisted: (value) => {
          events.push("apply");
          sidebarValue = value;
        },
      }),
    );
    registry.markEdited("tab:a");

    assert.equal(await registry.refreshOnFocus("sidebar:a"), "refreshed");
    assert.deepEqual(events, ["flush", "read", "apply"]);
    assert.equal(sidebarValue, "draft from tab");
  });

  it("does not overwrite the focused source while it has local work", async () => {
    const registry = new DocumentSyncRegistry();
    let reads = 0;
    let applies = 0;

    registry.register(source({ sourceID: "tab:a" }));
    registry.register(
      source({
        sourceID: "sidebar:a",
        hasLocalWork: () => true,
        readPersisted: async () => {
          reads += 1;
          return "new";
        },
        applyPersisted: () => {
          applies += 1;
        },
      }),
    );
    registry.markSaved("tab:a");

    assert.equal(await registry.refreshOnFocus("sidebar:a"), "skipped-dirty");
    assert.equal(reads, 0);
    assert.equal(applies, 0);
  });

  it("does not replace an editor when persisted content is unchanged", async () => {
    const registry = new DocumentSyncRegistry();
    let applies = 0;

    registry.register(source({ sourceID: "tab:a" }));
    registry.register(
      source({
        sourceID: "sidebar:a",
        getCurrentValue: () => "same",
        readPersisted: async () => "same",
        applyPersisted: () => {
          applies += 1;
        },
      }),
    );
    registry.markSaved("tab:a");

    assert.equal(await registry.refreshOnFocus("sidebar:a"), "unchanged");
    assert.equal(applies, 0);
    assert.equal(await registry.refreshOnFocus("sidebar:a"), "unchanged");
  });

  it("blocks refresh when a dirty peer cannot be flushed", async () => {
    const registry = new DocumentSyncRegistry();
    let reads = 0;

    registry.register(
      source({
        sourceID: "tab:a",
        hasLocalWork: () => true,
      }),
    );
    registry.register(
      source({
        sourceID: "sidebar:a",
        readPersisted: async () => {
          reads += 1;
          return "new";
        },
      }),
    );
    registry.markEdited("tab:a");

    assert.equal(
      await registry.refreshOnFocus("sidebar:a"),
      "blocked-peer-dirty",
    );
    assert.equal(reads, 0);
  });

  it("blocks when another peer becomes dirty while the newest peer flushes", async () => {
    const registry = new DocumentSyncRegistry();
    let newestDirty = true;
    let otherDirty = false;
    let reads = 0;

    registry.register(
      source({
        sourceID: "tab:newest",
        hasLocalWork: () => newestDirty,
        flush: async () => {
          newestDirty = false;
          otherDirty = true;
          registry.markEdited("tab:other");
          registry.markSaved("tab:newest");
        },
      }),
    );
    registry.register(
      source({
        sourceID: "tab:other",
        hasLocalWork: () => otherDirty,
      }),
    );
    registry.register(
      source({
        sourceID: "sidebar:a",
        readPersisted: async () => {
          reads += 1;
          return "new";
        },
      }),
    );
    registry.markEdited("tab:newest");

    assert.equal(
      await registry.refreshOnFocus("sidebar:a"),
      "blocked-peer-dirty",
    );
    assert.equal(reads, 0);
  });

  it("unregisters sources without retaining document content", () => {
    const registry = new DocumentSyncRegistry();
    const unregister = registry.register(source({ sourceID: "tab:a" }));

    assert.equal(registry.has("tab:a"), true);
    unregister();
    assert.equal(registry.has("tab:a"), false);
  });

  it("keeps a source stale when another save completes during its read", async () => {
    const registry = new DocumentSyncRegistry();
    const firstRead = deferred();
    let reads = 0;
    let persisted = "v1";
    let sidebarValue = "v0";

    registry.register(source({ sourceID: "tab:a" }));
    registry.register(
      source({
        sourceID: "sidebar:a",
        getCurrentValue: () => sidebarValue,
        readPersisted: async () => {
          reads += 1;
          const captured = persisted;
          if (reads === 1) await firstRead.promise;
          return captured;
        },
        applyPersisted: (value) => {
          sidebarValue = value;
        },
      }),
    );

    registry.markSaved("tab:a");
    const refresh = registry.refreshOnFocus("sidebar:a");
    await Promise.resolve();
    persisted = "v2";
    registry.markSaved("tab:a");
    firstRead.resolve();
    await refresh;

    assert.equal(sidebarValue, "v1");
    assert.equal(await registry.refreshOnFocus("sidebar:a"), "refreshed");
    assert.equal(sidebarValue, "v2");
    assert.equal(reads, 2);
  });

  it("does not apply a read after the focused source unregisters", async () => {
    const registry = new DocumentSyncRegistry();
    const read = deferred();
    let applies = 0;

    registry.register(source({ sourceID: "tab:a" }));
    const unregister = registry.register(
      source({
        sourceID: "sidebar:a",
        getCurrentValue: () => "old",
        readPersisted: async () => {
          await read.promise;
          return "new";
        },
        applyPersisted: () => {
          applies += 1;
        },
      }),
    );
    registry.markSaved("tab:a");

    const refresh = registry.refreshOnFocus("sidebar:a");
    await Promise.resolve();
    unregister();
    read.resolve();
    await refresh;

    assert.equal(applies, 0);
  });
});
