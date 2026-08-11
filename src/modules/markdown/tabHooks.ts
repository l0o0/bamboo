/**
 * Register Zotero_Tabs hooks for our custom tab type.
 *
 * Zotero parses tab types as `${contentType}-${state}` (split on `-`).
 * We use type `markdown` so contentType is `markdown`.
 *
 * Critical: when an attachment is opened, Zotero updates lastRead → item
 * modify → Zotero_Tabs.rename(id) with no title. Without getTitle, rename
 * sets tab.title = undefined and _update() crashes on tab.title.length.
 */

export const MARKDOWN_TAB_TYPE = "markdown";

export function registerMarkdownTabHooks(win: _ZoteroTypes.MainWindow) {
  const tabs = win.Zotero_Tabs as any;
  if (!tabs?.tabHooks) return;

  tabs.tabHooks.getTitle ??= {};
  tabs.tabHooks.refocus ??= {};
  tabs.tabHooks.focusFirst ??= {};

  tabs.tabHooks.getTitle[MARKDOWN_TAB_TYPE] = async (tab: {
    data?: { itemID?: number };
  }) => {
    return resolveMarkdownTabTitle(tab.data?.itemID);
  };

  // Avoid focusing nowhere after select
  tabs.tabHooks.refocus[MARKDOWN_TAB_TYPE] = async (tab: { id: string }) => {
    const host = win.document
      .getElementById(tab.id)
      ?.querySelector(".zotero-markdown-editor-host") as HTMLElement | null;
    if (!host) return;
    const iframe = host.querySelector(
      "iframe.zmd-codemirror-iframe",
    ) as HTMLIFrameElement | null;
    if (iframe) {
      try {
        iframe.focus();
        iframe.contentWindow?.postMessage(
          { source: "zotero-markdown-editor", type: "focus" },
          "*",
        );
      } catch {
        // ignore focus failures
      }
      return;
    }
    const legacy = host.querySelector(".zmd-textarea") as HTMLElement | null;
    legacy?.focus?.();
  };

  tabs.tabHooks.focusFirst[MARKDOWN_TAB_TYPE] =
    tabs.tabHooks.refocus[MARKDOWN_TAB_TYPE];
}

export async function resolveMarkdownTabTitle(
  itemID?: number,
): Promise<string> {
  try {
    if (!itemID) return "Markdown";
    const item = Zotero.Items.get(itemID);
    if (!item) return "Markdown";

    const fieldTitle = item.getField("title");
    if (fieldTitle) return String(fieldTitle);

    if (item.attachmentFilename) return String(item.attachmentFilename);

    // getDisplayTitle may be async in some builds
    const display = item.getDisplayTitle?.();
    if (display && typeof (display as any).then === "function") {
      const t = await display;
      if (t) return String(t);
    } else if (display) {
      return String(display);
    }
  } catch (e) {
    ztoolkit.log("resolveMarkdownTabTitle failed", e);
  }
  return "Markdown";
}
