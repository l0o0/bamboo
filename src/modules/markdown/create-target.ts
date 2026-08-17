import {
  getSelectedCollections,
  type ZoteroPaneSelectionLike,
} from "../../compat/zotero-pane";

export function resolveMarkdownCollectionID(
  pane: ZoteroPaneSelectionLike | null | undefined,
  explicitCollectionID?: number,
): number | undefined {
  if (explicitCollectionID != null) return explicitCollectionID;

  const collectionID = getSelectedCollections(pane, true)[0];
  return typeof collectionID === "number" && collectionID > 0
    ? collectionID
    : undefined;
}
