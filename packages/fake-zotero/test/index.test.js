import assert from "node:assert/strict";
import test from "node:test";
import { createFakeZotero } from "../dist/index.js";

test("instances are isolated and reset restores a deep fixture snapshot", async () => {
  const first = createFakeZotero({
    prefs: { "extensions.zotero.demo.enabled": true },
    items: [
      { id: 1, key: "same", itemType: "journalArticle" },
      { id: 2, key: "child", itemType: "note", parentID: 1, note: "old" },
    ],
  });
  const second = createFakeZotero({
    items: [{ id: 9, key: "same", itemType: "book", libraryID: 2 }],
  });

  assert.equal(first.Zotero.Items.getByLibraryAndKey(1, "same").id, 1);
  assert.equal(second.Zotero.Items.getByLibraryAndKey(1, "same"), false);
  assert.equal(first.Zotero.Items.get(2).parentItem.id, 1);
  first.Zotero.Items.get(2).setNote("new");
  await first.Zotero.Items.get(2).saveTx();
  assert.equal(first.Zotero.Items.get(2).getNote(), "new");
  assert.equal(first.calls.at(-1).method, "item.saveTx");
  assert.equal(first.snapshot().items[1].note, "new");
  first.reset();
  assert.equal(first.Zotero.Items.get(2).getNote(), "old");
  assert.deepEqual(first.calls, []);
});

test("Prefs preserve the Zotero namespace and global flag", () => {
  const fake = createFakeZotero({
    prefs: { "extensions.zotero.demo.n": 1, "demo.global": false },
  });
  assert.equal(fake.Zotero.Prefs.get("demo.n"), 1);
  fake.Zotero.Prefs.set("demo.n", 2);
  assert.equal(fake.Zotero.Prefs.get("extensions.zotero.demo.n", true), 2);
  assert.equal(fake.Zotero.Prefs.get("demo.global", true), false);
  fake.Zotero.Prefs.clear("demo.n");
  assert.equal(fake.Zotero.Prefs.get("demo.n"), undefined);
});

test("install refuses existing values and restore protects replacements", () => {
  const fake = createFakeZotero();
  const target = {};
  const restore = fake.install(target);
  assert.equal(target.Zotero, fake.Zotero);
  target.Zotero = { replacement: true };
  restore();
  assert.deepEqual(target.Zotero, { replacement: true });
  assert.throws(() => fake.install(target), /overwrite/);
  delete target.Zotero;
  const restoreAgain = fake.install(target);
  restoreAgain();
  assert.equal("Zotero" in target, false);
});

test("metadata search scopes libraries and preserves native note title semantics", async () => {
  const fake = createFakeZotero({
    items: [
      {
        id: 1,
        key: "PAPER001",
        itemType: "journalArticle",
        fields: { title: "Research" },
      },
      {
        id: 2,
        key: "ATTACH01",
        itemType: "attachment",
        parentID: 1,
        fields: { title: "Research notes" },
      },
      {
        id: 3,
        key: "NATIVE01",
        itemType: "note",
        parentID: 1,
        note: "<p>Research summary</p>",
      },
      {
        id: 4,
        key: "OTHER001",
        libraryID: 7,
        itemType: "journalArticle",
        fields: { title: "Research" },
      },
    ],
  });
  const partial = new fake.Zotero.Search({ libraryID: 1 });
  partial.addCondition("title", "contains", "RESEARCH");
  assert.deepEqual(await partial.search(), [1, 2]);
  const exact = new fake.Zotero.Search({ libraryID: 7 });
  exact.addCondition("title", "is", "research");
  assert.deepEqual(await exact.search(), [4]);
  partial.addCondition("itemType", "is", "attachment");
  assert.deepEqual(await partial.search(), [2]);
  const notes = new fake.Zotero.Search({ libraryID: 1 });
  notes.addCondition("itemType", "is", "note");
  assert.deepEqual(await notes.search(), [3]);
  assert.equal(fake.Zotero.Items.get(3).getField("title"), "Research summary");
  assert.equal(fake.Zotero.Items.get(2).parentItemID, 1);
  assert.throws(
    () => notes.addCondition("note", "contains", "summary"),
    /does not support/,
  );
  assert.throws(
    () => notes.addCondition("title", "isNot", "summary"),
    /does not support/,
  );
  fake.Zotero.Items.get(2).setField("title", "Changed");
  assert.deepEqual(await partial.search(), []);
  fake.reset();
  assert.deepEqual(await partial.search(), [2]);
});
