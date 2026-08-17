type PaneGetterName =
  | "getSelectedCollections"
  | "getSelectedCollection"
  | "getSelectedLibraryIDs"
  | "getSelectedLibraryID"
  | "getCollectionTreeRows"
  | "getCollectionTreeRow"
  | "getSelectedSavedSearches"
  | "getSelectedSavedSearch";

export interface ZoteroPaneSelectionLike {
  [key: string]: unknown;
  getSelectedCollections?: unknown;
  getSelectedCollection?: unknown;
  getSelectedLibraryIDs?: unknown;
  getSelectedLibraryID?: unknown;
  getCollectionTreeRows?: unknown;
  getCollectionTreeRow?: unknown;
  getSelectedSavedSearches?: unknown;
  getSelectedSavedSearch?: unknown;
}

function normalizeArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function callPluralOrSingular<T>(
  pane: ZoteroPaneSelectionLike | null | undefined,
  pluralName: PaneGetterName,
  singularName: PaneGetterName,
  args: [] | [boolean] = [],
): T[] {
  if (!pane) return [];

  const plural = pane[pluralName];
  if (typeof plural === "function") {
    return normalizeArray<T>(plural.apply(pane, args));
  }

  const singular = pane[singularName];
  if (typeof singular === "function") {
    return normalizeArray<T>(singular.apply(pane, args));
  }

  return [];
}

export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID: true,
): number[];
export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID?: false,
): Zotero.Collection[];
export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID = false,
): Array<Zotero.Collection | number> {
  return callPluralOrSingular<Zotero.Collection | number>(
    pane,
    "getSelectedCollections",
    "getSelectedCollection",
    [asID],
  );
}

export function getSelectedLibraryIDs(
  pane: ZoteroPaneSelectionLike | null | undefined,
): number[] {
  return callPluralOrSingular<number>(
    pane,
    "getSelectedLibraryIDs",
    "getSelectedLibraryID",
  );
}

export function getCollectionTreeRows(
  pane: ZoteroPaneSelectionLike | null | undefined,
): Zotero.CollectionTreeRow[] {
  return callPluralOrSingular<Zotero.CollectionTreeRow>(
    pane,
    "getCollectionTreeRows",
    "getCollectionTreeRow",
  );
}

export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID: true,
): number[];
export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID?: false,
): Zotero.Search[];
export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID = false,
): Array<Zotero.Search | number> {
  return callPluralOrSingular<Zotero.Search | number>(
    pane,
    "getSelectedSavedSearches",
    "getSelectedSavedSearch",
    [asID],
  );
}

export function getSelectedGroupRows(
  pane: ZoteroPaneSelectionLike | null | undefined,
): Zotero.CollectionTreeRow[] {
  return getCollectionTreeRows(pane).filter((row) => row.isGroup());
}
