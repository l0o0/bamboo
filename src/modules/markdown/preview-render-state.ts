export function isCurrentPreviewGeneration(
  started: number,
  current: number,
): boolean {
  return started === current;
}
