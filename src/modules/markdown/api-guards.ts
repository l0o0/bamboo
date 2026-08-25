/** Return true when an editor buffer drifted from the content observed by an API call. */
export function editorSnapshotChanged(
  observed: string,
  current: string,
): boolean {
  return observed !== current;
}
