import assert from "node:assert/strict";
import test from "node:test";
import {
  getCollectionTreeRows,
  getSelectedCollections,
  getSelectedGroupRows,
  getSelectedLibraryIDs,
  getSelectedSavedSearches,
  type ZoteroPaneSelectionLike,
} from "../src/compat/zotero-pane.ts";

test("prefers Zotero 10 plural collection getters and preserves all values", () => {
  const pane: ZoteroPaneSelectionLike = {
    marker: "pane",
    getSelectedCollections(asID?: boolean) {
      assert.equal(this.marker, "pane");
      assert.equal(asID, true);
      return [11, 22];
    },
    getSelectedCollection() {
      throw new Error("removed singular getter must not run");
    },
  };

  assert.deepEqual(getSelectedCollections(pane, true), [11, 22]);
});

test("wraps Zotero 9 singular collection and library results", () => {
  const collection = { id: 7 } as Zotero.Collection;
  const pane: ZoteroPaneSelectionLike = {
    getSelectedCollection(asID?: boolean) {
      return asID ? 7 : collection;
    },
    getSelectedLibraryID() {
      return 1;
    },
  };

  assert.deepEqual(getSelectedCollections(pane), [collection]);
  assert.deepEqual(getSelectedCollections(pane, true), [7]);
  assert.deepEqual(getSelectedLibraryIDs(pane), [1]);
});

test("returns empty arrays for unavailable panes and nullish selections", () => {
  assert.deepEqual(getSelectedCollections(undefined, true), []);
  assert.deepEqual(getSelectedLibraryIDs(null), []);
  assert.deepEqual(
    getSelectedSavedSearches({ getSelectedSavedSearch: () => undefined }),
    [],
  );
});

test("normalizes collection-tree rows and filters group rows", () => {
  const group = { isGroup: () => true } as Zotero.CollectionTreeRow;
  const collection = { isGroup: () => false } as Zotero.CollectionTreeRow;
  const pane: ZoteroPaneSelectionLike = {
    getCollectionTreeRows() {
      return [group, collection];
    },
    getCollectionTreeRow() {
      throw new Error("removed singular getter must not run");
    },
  };

  assert.deepEqual(getCollectionTreeRows(pane), [group, collection]);
  assert.deepEqual(getSelectedGroupRows(pane), [group]);
});

test("wraps Zotero 9 singular rows and saved searches", () => {
  const row = { isGroup: () => true } as Zotero.CollectionTreeRow;
  const search = { id: 9 } as Zotero.Search;
  const pane: ZoteroPaneSelectionLike = {
    getCollectionTreeRow: () => row,
    getSelectedSavedSearch: (asID?: boolean) => (asID ? 9 : search),
  };

  assert.deepEqual(getCollectionTreeRows(pane), [row]);
  assert.deepEqual(getSelectedGroupRows(pane), [row]);
  assert.deepEqual(getSelectedSavedSearches(pane), [search]);
  assert.deepEqual(getSelectedSavedSearches(pane, true), [9]);
});

test("does not suppress exceptions from an available plural getter", () => {
  const pane: ZoteroPaneSelectionLike = {
    getSelectedLibraryIDs() {
      throw new Error("collections view unavailable");
    },
  };

  assert.throws(
    () => getSelectedLibraryIDs(pane),
    /collections view unavailable/,
  );
});
