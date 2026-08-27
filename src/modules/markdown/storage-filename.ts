const STORED_MARKDOWN_PREFIX = "zmd-";

export function normalizeMarkdownFilename(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^(?:zmd-)+/i, "")
    .replace(/\.md$/i, "");
  const safe = trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${safe || "Note"}.md`;
}

export function storedMarkdownFilename(logicalFilename: string): string {
  return `${STORED_MARKDOWN_PREFIX}${normalizeMarkdownFilename(logicalFilename)}`;
}

export function logicalMarkdownFilename(storedFilename: string): string {
  return normalizeMarkdownFilename(storedFilename);
}

export function createMarkdownImportPaths(
  tempRoot: string,
  logicalFilename: string,
  uniqueID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): { directory: string; file: string } {
  const safeID = uniqueID.replace(/[^a-zA-Z0-9_-]/g, "-") || "import";
  const separator =
    tempRoot.includes("\\") && !tempRoot.includes("/") ? "\\" : "/";
  const root = tempRoot.replace(/[\\/]+$/, "");
  const directory = `${root}${separator}bamboo-${safeID}`;
  return {
    directory,
    file: `${directory}${separator}${storedMarkdownFilename(logicalFilename)}`,
  };
}
