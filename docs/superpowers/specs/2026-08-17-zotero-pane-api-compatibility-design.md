# Zotero Pane API Compatibility Layer Design

## Goal

Provide one stable, array-based selection API for Zotero Markdown across
Zotero 9 and Zotero 10. Business modules must not inspect Zotero versions or
call selection APIs whose return shape changes between releases.

## Background

Zotero 10 allows multiple rows to be selected in the collections tree. The
old singular selection getters were removed and now throw, while their plural
replacements return arrays. Zotero 9 exposes the singular getters and the
current `zotero-types` dependency still describes that older contract.

The plugin currently calls `ZoteroPane.getSelectedCollections(true)` directly
when creating a top-level Markdown attachment. That call works with the Zotero
10 contract but is not a stable cross-version boundary.

## Decision

Add a capability-detected compatibility layer. It will prefer a plural Zotero
10 API when present, otherwise call the corresponding Zotero 9 singular API
and wrap a non-null result in an array.

The compatibility layer always returns arrays. It does not collapse a Zotero
10 multi-selection to the first value. Each business operation must explicitly
decide whether it consumes the first selection or the complete selection.

Do not branch on `Zotero.version`. Capability detection is more resilient to
beta builds, backports, and type declarations that lag behind the runtime.

## Module Boundary

Create `src/compat/zotero-pane.ts`. It exposes these stable functions:

- `getSelectedCollections(pane, asID)`
- `getSelectedLibraryIDs(pane)`
- `getCollectionTreeRows(pane)`
- `getSelectedSavedSearches(pane, asID)`
- `getSelectedGroupRows(pane)`

The module uses a small structural pane type rather than augmenting Zotero's
global declarations. This isolates the old and new method signatures from the
rest of the plugin and avoids modifying the host application's objects.

## Normalization Rules

For every compatible getter:

1. Return `[]` when the pane is unavailable.
2. Prefer the plural method when it is a function.
3. Preserve the complete array returned by the plural method.
4. Otherwise call the singular method when it is a function.
5. Convert a non-null singular result to `[result]`.
6. Convert `null` or `undefined` to `[]`.

The compatibility layer only handles API availability and return-shape
differences. It must not catch and suppress unrelated exceptions from Zotero.
In particular, it must never call a removed singular method when the plural
replacement exists.

`getSelectedGroupRows()` is derived from collection-tree rows on both versions
by filtering rows whose `isGroup()` method returns true. It does not wrap the
old `getSelectedGroup()` result because that method returns a group object,
while Zotero 10's replacement is a collection-tree row; mixing those values
would violate the stable return contract.

## Consumer Migration

Replace the direct `getSelectedCollections(true)` call in
`createMarkdownAttachment()` with the compatibility function.

The creation workflow keeps its current behavior and uses only the first
selected collection ID. Supporting creation in every selected collection is a
separate product decision and is outside this compatibility change.

Future code that needs collection-tree selection must use this module instead
of calling the changed ZoteroPane methods directly.

## Testing

Add focused unit tests using structural pane mocks:

- Zotero 10 plural getters return their arrays unchanged.
- Zotero 9 singular getters are wrapped in arrays.
- Empty or unavailable selections return `[]`.
- The `asID` argument is forwarded correctly.
- A present plural getter prevents a throwing singular getter from running.
- Group rows are filtered correctly on Zotero 10.
- The Markdown creation selection helper keeps choosing the first collection.

Run the complete unit suite, TypeScript build, ESLint, and Prettier after the
consumer migration.

## Non-Goals

- Do not monkey-patch `ZoteroPane` or other Zotero globals.
- Do not provide compatibility wrappers for APIs the plugin does not use or
  reasonably expect to use for selection handling.
- Do not change multi-selection product behavior in Markdown creation.
- Do not update the plugin's supported Zotero version range in this change.
