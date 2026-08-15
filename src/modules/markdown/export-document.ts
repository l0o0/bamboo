import type { ImageAssetMap } from "./editor-protocol";
import { buildStandaloneDocument, documentTitle } from "./preview";

export function exportBasename(source: string): string {
  return (
    documentTitle(source)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Markdown"
  );
}

export async function buildExportHtml(options: {
  source: string;
  assets?: ImageAssetMap;
  theme?: "light" | "dark";
  title?: string;
}): Promise<string> {
  return buildStandaloneDocument(options).standaloneHtml;
}

export async function saveHtmlFile(
  win: Window,
  html: string,
  suggestedName: string,
): Promise<string | null> {
  const path = await new ztoolkit.FilePicker(
    "导出 HTML",
    "save",
    [["HTML", "*.html"]],
    `${suggestedName}.html`,
    win,
  ).open();
  if (!path) return null;
  await Zotero.File.putContentsAsync(path, html);
  return path;
}

/** Open the same standalone document for printing / Save as PDF. */
export function openPrintableDocument(win: Window, html: string): boolean {
  const printWin = win.open(
    "about:blank",
    "_blank",
    "chrome,centerscreen,resizable,width=920,height=760",
  );
  if (!printWin) return false;
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  printWin.setTimeout(() => {
    try {
      printWin.print();
    } catch (error) {
      ztoolkit.log("Print dialog failed", error);
    }
  }, 50);
  return true;
}
