import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SessionRegistry } from "../src/modules/markdown/session-registry.ts";
import { SaveCoordinator } from "../src/modules/markdown/save-coordinator.ts";

function session(registryNote: {
  tabID: string;
  itemID: number;
  win: Window;
  surface?: "tab" | "window";
}) {
  return {
    ...registryNote,
    surface: registryNote.surface ?? ("tab" as const),
    sourceID: `${registryNote.surface ?? "tab"}:${registryNote.tabID}`,
    isActive: () => true,
    updateTitle: () => undefined,
    path: "/tmp/note.md",
    storageLabel: "stored",
    mode: "live" as const,
    save: new SaveCoordinator({
      getSnapshot: () => ({ rev: 0, value: "" }),
      write: async () => undefined,
    }),
  };
}

describe("SessionRegistry", () => {
  it("keeps the same item open independently in two windows", () => {
    const registry = new SessionRegistry();
    const winA = {} as Window;
    const winB = {} as Window;
    registry.register(session({ tabID: "tab-a", itemID: 7, win: winA }));
    registry.register(session({ tabID: "tab-b", itemID: 7, win: winB }));

    assert.equal(registry.find(winA, 7)?.tabID, "tab-a");
    assert.equal(registry.find(winB, 7)?.tabID, "tab-b");
    assert.equal(registry.sessionsForWindow(winA).length, 1);
    assert.equal(registry.all().length, 2);
  });

  it("does not drop the other window when one session is unregistered", () => {
    const registry = new SessionRegistry();
    const winA = {} as Window;
    const winB = {} as Window;
    registry.register(session({ tabID: "tab-a", itemID: 7, win: winA }));
    registry.register(session({ tabID: "tab-b", itemID: 7, win: winB }));
    registry.unregister("tab-a");

    assert.equal(registry.find(winA, 7), undefined);
    assert.equal(registry.find(winB, 7)?.tabID, "tab-b");
    assert.equal(registry.get("tab-b")?.itemID, 7);
  });

  it("filters tab sessions without excluding standalone sessions globally", () => {
    const registry = new SessionRegistry();
    const main = {} as Window;
    const standalone = {} as Window;
    registry.register(session({ tabID: "tab-1", itemID: 7, win: main }));
    registry.register(
      session({
        tabID: "window-1",
        itemID: 7,
        win: standalone,
        surface: "window",
      }),
    );

    assert.deepEqual(
      registry.tabs().map((entry) => entry.tabID),
      ["tab-1"],
    );
    assert.equal(registry.find(main, 7, "tab")?.tabID, "tab-1");
    assert.equal(registry.find(standalone, 7, "window")?.tabID, "window-1");
    assert.equal(registry.all().length, 2);
  });

  it("publishes tab edits and saves and refreshes when focus returns", () => {
    const source = readFileSync(
      new URL("../src/modules/markdown/tab.ts", import.meta.url),
      "utf8",
    );

    assert.match(source, /documentSyncRegistry\.register/);
    assert.match(source, /documentSyncRegistry\.markEdited/);
    assert.match(source, /documentSyncRegistry\.markSaved/);
    assert.match(source, /documentSyncRegistry\s*\.\s*refreshOnFocus/);
    assert.match(source, /!session\.isActive\(\)/);
  });
});
