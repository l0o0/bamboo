import { createMarkdownEditor, resolveEditorTheme } from "./editor";
import {
  iconBold,
  iconCode,
  iconH1,
  iconH2,
  iconH3,
  iconItalic,
  iconImage,
  iconLive,
  iconList,
  iconLink,
  iconMoreHorizontal,
  iconOnlyButtonHtml,
  iconPanelLeft,
  iconRedo,
  iconSave,
  iconSource,
  iconTable,
  iconTask,
  iconUndo,
} from "./icons";
import { tableInsertTemplate } from "./insert-template";
import {
  EDITOR_MODE_OPTIONS,
  MORE_MENU_SECTIONS,
  modeLabel,
  moreMenuLabel,
  type MoreMenuAction,
} from "./more-menu";
import {
  hydratePreviewImages,
  mountPreviewHtml,
  scrollPreviewToOutline,
} from "./preview";
import {
  disposeMarkdownRenderer,
  AsyncRenderError,
  renderMarkdownAsync,
} from "./async-render";
import { isCurrentPreviewGeneration } from "./preview-render-state";
import {
  buildExportHtml,
  exportBasename,
  openPrintableDocument,
  saveHtmlFile,
} from "./export-document";
import {
  extractFirstHeadingTitle,
  frontmatterTitleChange,
} from "./frontmatter";
import {
  cleanupUnusedImageAssets,
  importExternalImages,
  resolveImageAssetEntry,
  resolveImageAssets,
  writeImageAsset,
} from "./images/service";
import { parseMarkdownImages } from "./images/model";
import {
  createMarkdownModalController,
  normalizeMarkdownFilename,
  type DocumentModalData,
  type SettingsModalData,
} from "./modal";
import { storedMarkdownFilename } from "./storage-filename";
import { markdownSettingsAbout, saveMarkdownSettings } from "./settings";
import { formatSavedStatus, formatStats } from "./status";
import { MARKDOWN_TAB_TYPE, resolveMarkdownTabTitle } from "./tabHooks";
import { SaveCoordinator } from "./save-coordinator";
import { persistMarkdownContent } from "./persist";
import {
  sessionRegistry,
  type OpenSession,
  type SessionView,
} from "./session-registry";
import { ensureDOMGlobals, getDOMDocument } from "../../utils/dom";
import { getString } from "../../utils/locale";
import type { EditorOutlineItem, EditorTheme } from "./editor-protocol";
import { mountOutlineSidebar } from "./outline-sidebar";
import { documentSyncRegistry } from "./document-sync";

const AUTOSAVE_MS = 800;
const TITLE_SYNC_MS = 1000;

export function modeToggleState(mode: "live" | "source" | "preview") {
  if (mode === "source" || mode === "preview") {
    return {
      target: "live" as const,
      icon: iconLive(),
      label: getString("tab-mode-toggle-live"),
    };
  }
  return {
    target: "source" as const,
    icon: iconSource(),
    label: getString("tab-mode-toggle-source"),
  };
}

export function getSessionByTabID(tabID: string) {
  return sessionRegistry.get(tabID);
}

/**
 * Open (or focus) a Markdown editor tab for an attachment item.
 */
export async function openMarkdownTab(
  item: Zotero.Item,
  options: { win?: _ZoteroTypes.MainWindow } = {},
): Promise<string | null> {
  const win =
    options.win ||
    (Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined);
  if (!win) {
    ztoolkit.log("No main window for Markdown tab");
    return null;
  }

  ensureDOMGlobals(win);

  const existing = sessionRegistry.find(win, item.id);
  if (existing) {
    const tabInfo = win.Zotero_Tabs._getTab(existing.tabID);
    if (tabInfo?.tab) {
      ensureTabTitle(win, existing.tabID, item.id);
      try {
        win.Zotero_Tabs.select(existing.tabID);
      } catch (e) {
        ztoolkit.log("select existing markdown tab failed", e);
        ensureTabTitle(win, existing.tabID, item.id);
        win.Zotero_Tabs.select(existing.tabID);
      }
      void refreshSessionOnFocus(existing);
      existing.editor?.focus();
      return existing.tabID;
    }
    sessionRegistry.unregister(existing.tabID);
  }

  const path = await item.getFilePathAsync();
  if (!path) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Markdown file not found", type: "fail" })
      .show();
    return null;
  }

  let content: string;
  try {
    const raw = await Zotero.File.getContentsAsync(path);
    content = typeof raw === "string" ? raw : String(raw ?? "");
    ztoolkit.log("[Bamboo][EditorDebug] file-read", {
      itemID: item.id,
      path,
      rawType: typeof raw,
      contentLength: content.length,
    });
  } catch (e) {
    ztoolkit.log("Failed to read markdown file", e);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Failed to read markdown file", type: "fail" })
      .show();
    return null;
  }

  const title = await resolveMarkdownTabTitle(item.id);
  const storageLabel = item.isStoredFileAttachment?.()
    ? "stored"
    : item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE
      ? "linked"
      : "file";

  const { id: tabID, container } = win.Zotero_Tabs.add({
    type: MARKDOWN_TAB_TYPE,
    title,
    data: { itemID: item.id },
    select: false,
    onClose: () => {
      void closeSession(tabID, { flush: true });
    },
  });

  const host = container as unknown as HTMLElement;
  host.classList.add("zotero-markdown-tab-content");
  try {
    host.setAttribute("flex", "1");
  } catch {
    // ignore
  }

  const session: OpenSession = {
    tabID,
    itemID: item.id,
    path,
    mode: "live",
    previewRenderGeneration: 0,
    outlineItems: [],
    outlineActiveID: null,
    outlineExpanded: true,
    storageLabel,
    win,
    save: null as unknown as SaveCoordinator,
  };
  session.save = createSessionSave(session);
  sessionRegistry.register(session);

  try {
    mountEditorUI(win, host, session, content, item);
  } catch (e) {
    ztoolkit.log("Failed to mount markdown editor", e);
    try {
      win.Zotero_Tabs.close(tabID);
    } catch {
      // ignore
    }
    sessionRegistry.unregister(tabID);
    throw e;
  }

  ensureTabTitle(win, tabID, item.id);
  try {
    win.Zotero_Tabs.select(tabID);
  } catch (e) {
    ztoolkit.log("select markdown tab failed, repairing title", e);
    ensureTabTitle(win, tabID, item.id);
    win.Zotero_Tabs.select(tabID);
  }

  return tabID;
}

function ensureTabTitle(
  win: _ZoteroTypes.MainWindow,
  tabID: string,
  itemID: number,
) {
  const { tab } = win.Zotero_Tabs._getTab(tabID) || {};
  if (!tab) return;
  if (typeof tab.title !== "string") {
    tab.title = "Markdown";
  }
  void (async () => {
    try {
      const t = await resolveMarkdownTabTitle(itemID);
      const info = win.Zotero_Tabs._getTab(tabID);
      if (info?.tab) {
        info.tab.title = t;
        (win.Zotero_Tabs as any)._update?.();
      }
    } catch {
      // ignore
    }
  })();
}

function applyShellTheme(root: HTMLElement | undefined, theme: EditorTheme) {
  if (!root) return;
  root.classList.toggle("theme-dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
}

/**
 * Keep shell + iframe CM in sync when Zotero/OS color scheme changes.
 * Mirrors Zotero's own Ace/Monaco tools (matchMedia change listener).
 */
function bindSessionTheme(win: _ZoteroTypes.MainWindow, session: OpenSession) {
  session.unbindTheme?.();

  const sync = () => {
    const theme = resolveEditorTheme(win);
    applyShellTheme(session.view?.root, theme);
    session.editor?.setTheme(theme);
  };

  let mql: MediaQueryList | null = null;
  const onMql = () => sync();
  try {
    mql = win.matchMedia?.("(prefers-color-scheme: dark)") || null;
    mql?.addEventListener?.("change", onMql);
  } catch {
    // ignore
  }

  let observer: MutationObserver | null = null;
  try {
    const rootEl = win.document?.documentElement;
    if (rootEl && typeof win.MutationObserver === "function") {
      let last = resolveEditorTheme(win);
      const obs = new win.MutationObserver(() => {
        const next = resolveEditorTheme(win);
        if (next !== last) {
          last = next;
          sync();
        }
      });
      obs.observe(rootEl, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "theme", "style"],
      });
      observer = obs;
    }
  } catch {
    // ignore
  }

  session.unbindTheme = () => {
    try {
      mql?.removeEventListener?.("change", onMql);
    } catch {
      // ignore
    }
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
  };
}

function bindSessionDocumentSync(session: OpenSession) {
  session.unbindDocumentSync?.();
  const editor = session.editor;
  if (!editor) return;

  const sourceID = `tab:${session.tabID}`;
  session.documentSyncSourceID = sourceID;
  const unregister = documentSyncRegistry.register({
    sourceID,
    itemID: session.itemID,
    hasLocalWork: () => session.save.dirty || session.save.writing,
    flush: async () => {
      await requestSave(session, { force: true });
    },
    getCurrentValue: () => editor.getValue(),
    readPersisted: async () => {
      const raw = await Zotero.File.getContentsAsync(session.path);
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    applyPersisted: (value) => applyPersistedToSession(session, value),
  });

  const editorHost = session.view?.editorHost;
  const onEditorFocus = () => {
    void refreshSessionOnFocus(session);
  };
  const onWindowFocus = () => {
    void refreshSessionOnFocus(session);
  };
  editorHost?.addEventListener("focusin", onEditorFocus);
  session.win.addEventListener("focus", onWindowFocus);

  session.unbindDocumentSync = () => {
    editorHost?.removeEventListener("focusin", onEditorFocus);
    session.win.removeEventListener("focus", onWindowFocus);
    unregister();
    if (session.documentSyncSourceID === sourceID) {
      session.documentSyncSourceID = undefined;
    }
  };
}

function refreshSessionOnFocus(session: OpenSession): Promise<void> {
  if (
    session.closing ||
    !session.editor ||
    !session.documentSyncSourceID ||
    session.win.Zotero_Tabs.selectedID !== session.tabID
  ) {
    return Promise.resolve();
  }
  if (session.documentSyncRefresh) return session.documentSyncRefresh;

  const refresh = documentSyncRegistry
    .refreshOnFocus(session.documentSyncSourceID)
    .then((result) => {
      if (result === "blocked-peer-dirty") {
        ztoolkit.log("Markdown focus refresh blocked by unsaved peer", {
          itemID: session.itemID,
          sourceID: session.documentSyncSourceID,
        });
      }
    })
    .catch((error) => {
      ztoolkit.log("Markdown focus refresh failed", error);
    })
    .finally(() => {
      if (session.documentSyncRefresh === refresh) {
        session.documentSyncRefresh = undefined;
      }
    });
  session.documentSyncRefresh = refresh;
  return refresh;
}

function applyPersistedToSession(session: OpenSession, value: string) {
  const editor = session.editor;
  if (!editor || session.save.dirty || session.save.writing) return;
  if (editor.getValue() === value) return;

  editor.setValue(value);
  session.save.adoptPersistedSnapshot();
  updateMeta(session);
  updateSaveStatus(session);
  ensureTabTitle(session.win, session.tabID, session.itemID);
  if (session.mode === "preview") {
    void showReadOnlyPreview(session);
  } else {
    void refreshImageAssets(session);
  }
}

function mountEditorUI(
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
  session: OpenSession,
  content: string,
  item: Zotero.Item,
) {
  ztoolkit.log("[Bamboo][EditorDebug] tab-mount-start", {
    tabID: session.tabID,
    itemID: session.itemID,
    docLength: content.length,
  });
  ensureDOMGlobals(win);
  const doc = getDOMDocument(win);
  const dark = resolveEditorTheme(win) === "dark";

  const root = ztoolkit.UI.createElement(doc, "div", {
    namespace: "html",
    styles: {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    classList: [
      "zotero-markdown-root",
      "mode-live",
      ...(dark ? ["theme-dark"] : ["theme-light"]),
    ],
    children: [
      {
        tag: "div",
        namespace: "html",
        classList: ["zotero-markdown-toolbar"],
        children: [
          {
            tag: "div",
            namespace: "html",
            classList: ["zotero-markdown-toolbar-inner"],
            children: [
              {
                tag: "button",
                namespace: "html",
                classList: [
                  "zotero-markdown-btn",
                  "zotero-markdown-outline-toggle",
                ],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconPanelLeft()),
                },
                attributes: {
                  "data-action": "outline-toggle",
                  title: getString("markdown-outline-toggle"),
                  "aria-label": getString("markdown-outline-toggle"),
                  "aria-expanded": "true",
                },
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-sep"],
              },
              {
                tag: "button",
                namespace: "html",
                classList: ["zotero-markdown-btn", "zotero-markdown-btn-save"],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconSave()),
                },
                attributes: {
                  "data-action": "save",
                  title: getString("tab-save-title"),
                  "aria-label": getString("tab-save"),
                },
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-sep"],
              },
              ...[
                [
                  "undo",
                  iconUndo(),
                  getString("tab-undo"),
                  getString("tab-undo-title"),
                ],
                [
                  "redo",
                  iconRedo(),
                  getString("tab-redo"),
                  getString("tab-redo-title"),
                ],
              ].map(([action, icon, label, title]) => ({
                tag: "button",
                namespace: "html",
                classList: ["zotero-markdown-btn", "zmd-toolbar-icon-btn"],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(icon),
                },
                attributes: {
                  "data-action": action,
                  title,
                  "aria-label": label,
                },
              })),
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-sep"],
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-fmt"],
                children: [
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconBold()),
                    },
                    attributes: {
                      "data-action": "bold",
                      title: getString("tab-bold-title"),
                      "aria-label": getString("tab-bold"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconItalic()),
                    },
                    attributes: {
                      "data-action": "italic",
                      title: getString("tab-italic-title"),
                      "aria-label": getString("tab-italic"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconH1()),
                    },
                    attributes: {
                      "data-action": "h1",
                      title: getString("tab-h1-title"),
                      "aria-label": getString("tab-h1"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconH2()),
                    },
                    attributes: {
                      "data-action": "h2",
                      title: getString("tab-h2-title"),
                      "aria-label": getString("tab-h2"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconH3()),
                    },
                    attributes: {
                      "data-action": "h3",
                      title: getString("tab-h3"),
                      "aria-label": getString("tab-h3"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconList()),
                    },
                    attributes: {
                      "data-action": "list",
                      title: getString("tab-list"),
                      "aria-label": getString("tab-list"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconLink()),
                    },
                    attributes: {
                      "data-action": "link",
                      title: getString("tab-link-title"),
                      "aria-label": getString("tab-link"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconImage()),
                    },
                    attributes: {
                      "data-action": "image",
                      title: getString("tab-image"),
                      "aria-label": getString("tab-image"),
                    },
                  },
                  {
                    tag: "div",
                    namespace: "html",
                    classList: ["zotero-markdown-table-control"],
                    children: [
                      {
                        tag: "button",
                        namespace: "html",
                        classList: ["zotero-markdown-btn"],
                        properties: {
                          type: "button",
                          innerHTML: iconOnlyButtonHtml(iconTable()),
                        },
                        attributes: {
                          "data-action": "table",
                          title: getString("tab-table"),
                          "aria-label": getString("tab-table"),
                          "aria-haspopup": "true",
                          "aria-expanded": "false",
                        },
                      },
                      {
                        tag: "div",
                        namespace: "html",
                        classList: ["zotero-markdown-table-picker"],
                        attributes: { hidden: "true" },
                        children: [
                          {
                            tag: "div",
                            namespace: "html",
                            classList: ["zotero-markdown-table-grid"],
                            children: Array.from({ length: 64 }, (_, index) => {
                              const row = Math.floor(index / 8) + 1;
                              const column = (index % 8) + 1;
                              return {
                                tag: "button",
                                namespace: "html",
                                classList: ["zotero-markdown-table-cell"],
                                properties: { type: "button" },
                                attributes: {
                                  "data-table-rows": String(row),
                                  "data-table-columns": String(column),
                                  "aria-label": `Insert ${column} by ${row} table`,
                                },
                              };
                            }),
                          },
                          {
                            tag: "div",
                            namespace: "html",
                            classList: ["zotero-markdown-table-size"],
                            properties: { innerText: "3 × 3" },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconTask()),
                    },
                    attributes: {
                      "data-action": "task",
                      title: getString("tab-task"),
                      "aria-label": getString("tab-task"),
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconCode()),
                    },
                    attributes: {
                      "data-action": "code",
                      title: getString("tab-code"),
                      "aria-label": getString("tab-code"),
                    },
                  },
                ],
              },
              {
                tag: "span",
                namespace: "html",
                classList: ["zotero-markdown-toolbar-spacer"],
              },
              {
                tag: "button",
                namespace: "html",
                classList: [
                  "zotero-markdown-btn",
                  "zotero-markdown-mode-toggle",
                ],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconSource()),
                },
                attributes: {
                  "data-action": "mode-toggle",
                  title: getString("tab-mode-toggle-source"),
                  "aria-label": getString("tab-mode-toggle-source"),
                  "aria-pressed": "false",
                },
              },
              {
                tag: "button",
                namespace: "html",
                classList: ["zotero-markdown-btn", "zotero-markdown-more"],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconMoreHorizontal()),
                },
                attributes: {
                  "data-action": "more",
                  title: getString("tab-more"),
                  "aria-label": getString("tab-more"),
                },
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-more-menu"],
                attributes: { hidden: "true" },
              },
            ],
          },
        ],
      },
      {
        tag: "div",
        namespace: "html",
        classList: ["zotero-markdown-body"],
        children: [
          {
            tag: "nav",
            namespace: "html",
            classList: ["zotero-markdown-outline-sidebar"],
            attributes: {
              "aria-label": getString("markdown-outline-title"),
            },
            children: [
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-outline-list"],
                attributes: { role: "tree" },
              },
            ],
          },
          {
            tag: "div",
            namespace: "html",
            classList: ["zotero-markdown-workspace"],
            children: [
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-editor-host"],
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-preview-host"],
              },
            ],
          },
        ],
      },
      {
        tag: "div",
        namespace: "html",
        classList: ["zotero-markdown-statusbar"],
        children: [
          {
            tag: "span",
            namespace: "html",
            classList: ["zotero-markdown-meta"],
            properties: { innerText: "" },
          },
          {
            tag: "span",
            namespace: "html",
            classList: ["zotero-markdown-save-status", "is-saved"],
            properties: { innerText: "" },
          },
        ],
      },
    ],
  }) as HTMLDivElement;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.appendChild(root);
  const toolbar = root.querySelector(".zotero-markdown-toolbar");
  const ownerWindow = root.ownerDocument.defaultView;
  const toolbarInner = root.querySelector(".zotero-markdown-toolbar-inner");
  ztoolkit.log("[Bamboo][EditorDebug] tab-root-mounted", {
    tabID: session.tabID,
    hasEditorHost: !!root.querySelector(".zotero-markdown-editor-host"),
    hasToolbar: !!root.querySelector(".zotero-markdown-toolbar"),
    toolbarButtonCount: toolbar?.querySelectorAll("button").length ?? 0,
    toolbarInnerChildCount: toolbarInner?.children.length ?? 0,
    childCount: root.children.length,
    toolbarDisplay:
      toolbar && ownerWindow
        ? ownerWindow.getComputedStyle?.(toolbar)?.display || "unknown"
        : "missing",
  });

  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    const tableCell = t?.closest?.(
      "[data-table-rows][data-table-columns]",
    ) as HTMLElement | null;
    if (tableCell && root.contains(tableCell)) {
      const rows = Number(tableCell.dataset.tableRows);
      const columns = Number(tableCell.dataset.tableColumns);
      const template = tableInsertTemplate(rows, columns);
      session.editor?.insertText(
        template.text,
        template.selectionFrom,
        template.selectionTo,
      );
      session.closeTablePicker?.();
      return;
    }
    const btn = t?.closest?.("[data-action]") as HTMLElement | null;
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute("data-action");
    if (action === "preview-back") setMode(session, "live");
    else if (action === "preview-retry") void showReadOnlyPreview(session);
    else if (action === "save")
      void requestSave(session, { force: true, cleanupImages: true });
    else if (action === "undo" || action === "redo") {
      session.editor?.command(action);
    } else if (action === "bold") session.editor?.wrapSelection("**");
    else if (action === "italic") session.editor?.wrapSelection("*");
    else if (action === "h1") session.editor?.prefixLine("# ");
    else if (action === "h2") session.editor?.prefixLine("## ");
    else if (action === "h3") session.editor?.prefixLine("### ");
    else if (action === "list") session.editor?.prefixLine("- ");
    else if (action === "task") session.editor?.prefixLine("- [ ] ");
    else if (action === "code") session.editor?.wrapSelection("`");
    else if (action === "link") session.editor?.wrapSelection("[", "](url)");
    else if (action === "table") {
      toggleTablePicker(session);
    } else if (action === "image") {
      void chooseAndInsertImage(session);
    } else if (action === "mode-toggle") {
      const toggle = modeToggleState(session.mode);
      setMode(session, toggle.target);
    } else if (action === "more") {
      toggleMoreMenu(session);
    }
  });

  const view: SessionView = {
    root,
    outlineSidebarEl: root.querySelector(
      ".zotero-markdown-outline-sidebar",
    ) as HTMLElement,
    outlineListEl: root.querySelector(
      ".zotero-markdown-outline-list",
    ) as HTMLElement,
    outlineToggleEl: root.querySelector(
      ".zotero-markdown-outline-toggle",
    ) as HTMLButtonElement,
    workspaceEl: root.querySelector(
      ".zotero-markdown-workspace",
    ) as HTMLElement,
    editorHost: root.querySelector(
      ".zotero-markdown-editor-host",
    ) as HTMLElement,
    previewEl: root.querySelector(
      ".zotero-markdown-preview-host",
    ) as HTMLElement,
    metaEl: root.querySelector(".zotero-markdown-meta") as HTMLElement,
    saveStatusEl: root.querySelector(
      ".zotero-markdown-save-status",
    ) as HTMLElement,
  };
  session.view = view;
  session.outlineSidebar = mountOutlineSidebar({
    root,
    sidebar: view.outlineSidebarEl,
    list: view.outlineListEl,
    toolbarToggle: view.outlineToggleEl,
    emptyLabel: getString("markdown-outline-empty"),
    getExpanded: () => session.outlineExpanded !== false,
    onExpandedChange: (expanded) => {
      setOutlineExpanded(session, expanded);
    },
    onNavigate: (outlineItem) => {
      navigateToOutlineItem(session, outlineItem);
    },
  });
  session.outlineSidebar.update([], null);
  session.modal = createMarkdownModalController(
    win.document,
    {
      onRename: (filename) => renameSessionAttachment(session, filename),
      onReveal: () => revealSessionFolder(session),
      onSettings: (settings) => saveModalSettings(settings),
    },
    { mount: root, about: markdownSettingsAbout() },
  );
  view.previewEl.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:/i.test(href)) return;
    event.preventDefault();
    Zotero.launchURL(href);
  });
  bindTablePicker(session);
  mountMoreMenu(session);

  applyModeVisibility(session, "live");

  const readOnly = !item.isEditable();
  session.editor = createMarkdownEditor(view.editorHost, {
    doc: content ?? "",
    readOnly,
    win,
    channel: `${session.tabID}:${session.itemID}`,
    onOutline: (items, activeID) => {
      session.outlineItems = [...items];
      session.outlineActiveID = activeID;
      session.outlineSidebar?.update(items, activeID);
    },
    onOutlineActive: (activeID) => {
      session.outlineActiveID = activeID;
      session.outlineSidebar?.setActive(activeID);
    },
    onChange: (value) => {
      const appliedTitleSync = !!session.applyingTitleSync;
      session.applyingTitleSync = false;
      session.save.markChanged();
      if (session.documentSyncSourceID) {
        documentSyncRegistry.markEdited(session.documentSyncSourceID);
      }
      setStatus(session, "dirty", getString("status-unsaved"));
      updateMeta(session);
      scheduleImageAssetRefresh(session);
      const headingTitle = extractFirstHeadingTitle(value);
      const titleChange = headingTitle
        ? frontmatterTitleChange(value, headingTitle)
        : null;
      if (titleChange && !appliedTitleSync) {
        scheduleTitleSync(session);
      } else if (appliedTitleSync) {
        const force = !!session.pendingExplicitSave;
        const cleanupImages = !!session.pendingImageCleanup;
        session.pendingExplicitSave = false;
        session.pendingImageCleanup = false;
        void requestSave(session, { force, cleanupImages });
      } else {
        scheduleAutosave(session);
      }
      if (session.pendingImageSave) {
        session.pendingImageSave = false;
        void requestSave(session);
      }
    },
    onSave: () => {
      if (session.titleSyncTimer) {
        session.pendingExplicitSave = true;
        session.pendingImageCleanup = true;
        flushTitleSync(session);
      } else {
        void requestSave(session, { force: true, cleanupImages: true });
      }
    },
    onPasteImage: ({ bytes, mimeType }) => {
      void insertImageBytes(session, new Uint8Array(bytes), mimeType);
    },
    onResolveAsset: (reference) => {
      const item = Zotero.Items.get(session.itemID);
      if (!item)
        return Promise.resolve({ error: getString("error-attachment-gone") });
      return resolveImageAssetEntry(item, reference);
    },
  });
  ztoolkit.log("[Bamboo][EditorDebug] tab-editor-created", {
    tabID: session.tabID,
  });
  // Default iframe mode is live (init.mode)
  session.editor.setMode("live");
  bindSessionDocumentSync(session);
  void refreshImageAssets(session);

  bindSessionTheme(win, session);
  updateMeta(session);
  updateSaveStatus(session);

  const measure = () => {
    session.editor?.view.requestMeasure();
    if (session.mode === "live" || session.mode === "source") {
      session.editor?.focus();
    }
  };
  win.requestAnimationFrame(measure);
  win.setTimeout(measure, 50);
  win.setTimeout(measure, 200);
}

function setOutlineExpanded(session: OpenSession, expanded: boolean) {
  session.outlineExpanded = expanded;
  session.outlineSidebar?.setExpanded(expanded);
  session.win.requestAnimationFrame(() => {
    session.editor?.view.requestMeasure();
  });
}

function navigateToOutlineItem(session: OpenSession, item: EditorOutlineItem) {
  if (session.mode === "preview" && session.view?.previewEl) {
    scrollPreviewToOutline(session.view.previewEl, item.id);
    return;
  }
  session.editor?.revealPosition(item.from);
}

function applyModeVisibility(
  session: OpenSession,
  mode: "live" | "source" | "preview",
) {
  const root = session.view?.root;
  const editorHost = session.view?.editorHost;
  const previewEl = session.view?.previewEl;

  if (root) {
    root.classList.toggle("mode-live", mode === "live");
    root.classList.toggle("mode-source", mode === "source");
    root.classList.toggle("mode-preview", mode === "preview");
    root.classList.toggle("mode-edit", mode === "live" || mode === "source");
  }

  if (editorHost) {
    editorHost.style.display =
      mode === "live" || mode === "source" ? "flex" : "none";
  }
  if (previewEl) {
    previewEl.style.display = mode === "preview" ? "block" : "none";
  }
}

function mountMoreMenu(session: OpenSession) {
  const root = session.view?.root;
  if (!root) return;
  const menu = root.querySelector(".zotero-markdown-more-menu") as HTMLElement;
  if (!menu) return;

  menu.replaceChildren();
  MORE_MENU_SECTIONS.forEach((section, index) => {
    if (index > 0) {
      const separator = menu.ownerDocument.createElement("div");
      separator.className = "zotero-markdown-more-menu-separator";
      menu.appendChild(separator);
    }
    for (const item of section) {
      const button = menu.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "zotero-markdown-more-menu-item";
      button.dataset.menuAction = item.action;
      button.append(moreMenuLabel(item.action));
      if (item.shortcut) {
        const shortcut = menu.ownerDocument.createElement("span");
        shortcut.className = "zotero-markdown-more-menu-shortcut";
        shortcut.textContent = item.shortcut;
        button.appendChild(shortcut);
      }
      if (item.submenu) {
        const chevron = menu.ownerDocument.createElement("span");
        chevron.className = "zotero-markdown-more-menu-chevron";
        chevron.textContent = "›";
        button.appendChild(chevron);
      }
      if (item.action === "mode") {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "zotero-markdown-mode-submenu");
      }
      menu.appendChild(button);
      if (item.action === "mode") {
        menu.appendChild(createModeSubmenu(menu.ownerDocument));
      }
    }
  });

  const modeButton = menu.querySelector<HTMLElement>(
    '[data-menu-action="mode"]',
  );
  const modeMenu = menu.querySelector<HTMLElement>(
    ".zotero-markdown-mode-submenu",
  );

  const collapseModeMenu = () => {
    if (modeMenu) modeMenu.hidden = true;
    modeButton?.setAttribute("aria-expanded", "false");
  };
  const close = () => {
    menu.hidden = true;
    collapseModeMenu();
  };
  const onMenuClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const mode = target?.closest?.("[data-mode]")?.getAttribute("data-mode");
    if (mode === "live" || mode === "source" || mode === "preview") {
      setMode(session, mode);
      close();
      return;
    }

    const action = target
      ?.closest?.("[data-menu-action]")
      ?.getAttribute("data-menu-action") as MoreMenuAction | null;
    if (!action) return;
    if (action === "mode") {
      const opening = !!modeMenu?.hidden;
      if (modeMenu) modeMenu.hidden = !opening;
      modeButton?.setAttribute("aria-expanded", String(opening));
      if (opening && modeMenu) syncModeSubmenu(session, modeMenu);
      return;
    }
    if (action === "find") {
      session.editor?.command("find");
      close();
      return;
    }
    if (action === "source") {
      setMode(session, "source");
      close();
      return;
    }
    if (action === "document-info") {
      void openDocumentInfoModal(session);
      close();
      return;
    }
    if (action === "rename") {
      void openRenameModal(session);
      close();
      return;
    }
    if (action === "show-in-folder") {
      void revealSessionFolder(session);
      close();
      return;
    }
    if (action === "import-external-images") {
      void importExternalImagesInSession(session);
      close();
      return;
    }
    if (action === "cleanup-images") {
      void cleanupImagesInSession(session);
      close();
      return;
    }
    if (action === "export-html") {
      void exportSessionHtml(session);
      close();
      return;
    }
    if (action === "export-pdf") {
      void exportSessionPdf(session);
      close();
      return;
    }
    if (action === "settings") {
      session.modal?.open("settings");
      close();
      return;
    }
    showUnavailableAction(action);
    close();
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (
      !menu.hidden &&
      target &&
      !menu.contains(target) &&
      !(target as Element).closest?.('[data-action="more"]')
    ) {
      close();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  menu.addEventListener("click", onMenuClick);
  root.ownerDocument.addEventListener("pointerdown", onPointerDown);
  root.ownerDocument.addEventListener("keydown", onKeyDown);
  session.closeMoreMenu = () => {
    close();
    menu.removeEventListener("click", onMenuClick);
    root.ownerDocument.removeEventListener("pointerdown", onPointerDown);
    root.ownerDocument.removeEventListener("keydown", onKeyDown);
  };
}

function createModeSubmenu(doc: Document) {
  const submenu = doc.createElement("div");
  submenu.className = "zotero-markdown-mode-submenu";
  submenu.id = "zotero-markdown-mode-submenu";
  submenu.hidden = true;
  submenu.setAttribute("role", "group");
  for (const option of EDITOR_MODE_OPTIONS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zotero-markdown-more-menu-item";
    button.dataset.mode = option.mode;
    button.setAttribute("role", "menuitemradio");
    const mark = doc.createElement("span");
    mark.className = "zotero-markdown-mode-check";
    mark.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.textContent = modeLabel(option.mode);
    button.append(mark, label);
    submenu.appendChild(button);
  }
  return submenu;
}

function syncModeSubmenu(session: OpenSession, submenu: HTMLElement) {
  for (const button of submenu.querySelectorAll<HTMLElement>("[data-mode]")) {
    const checked = button.dataset.mode === session.mode;
    button.classList.toggle("is-checked", checked);
    button.setAttribute("aria-checked", String(checked));
  }
}

function toggleMoreMenu(session: OpenSession) {
  const menu = session.view?.root?.querySelector(
    ".zotero-markdown-more-menu",
  ) as HTMLElement | undefined;
  if (!menu) return;
  session.closeTablePicker?.();
  const opening = menu.hidden;
  menu.hidden = !opening;
  const modeMenu = menu.querySelector<HTMLElement>(
    ".zotero-markdown-mode-submenu",
  );
  const modeButton = menu.querySelector<HTMLElement>(
    '[data-menu-action="mode"]',
  );
  if (opening) {
    if (modeMenu) syncModeSubmenu(session, modeMenu);
  } else if (modeMenu) {
    modeMenu.hidden = true;
    modeButton?.setAttribute("aria-expanded", "false");
  }
}

function updateTablePickerSelection(
  picker: HTMLElement,
  rows: number,
  columns: number,
) {
  for (const cell of picker.querySelectorAll<HTMLElement>(
    ".zotero-markdown-table-cell",
  )) {
    cell.classList.toggle(
      "is-selected",
      Number(cell.dataset.tableRows) <= rows &&
        Number(cell.dataset.tableColumns) <= columns,
    );
  }
  const label = picker.querySelector<HTMLElement>(
    ".zotero-markdown-table-size",
  );
  if (label) label.textContent = `${columns} × ${rows}`;
}

function bindTablePicker(session: OpenSession) {
  const root = session.view?.root;
  const picker = root?.querySelector<HTMLElement>(
    ".zotero-markdown-table-picker",
  );
  const trigger = root?.querySelector<HTMLElement>('[data-action="table"]');
  if (!root || !picker || !trigger) return;
  updateTablePickerSelection(picker, 3, 3);

  const close = () => {
    picker.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const onPointerOver = (event: PointerEvent) => {
    const cell = (event.target as Element | null)?.closest?.(
      "[data-table-rows][data-table-columns]",
    ) as HTMLElement | null;
    if (!cell || !picker.contains(cell)) return;
    updateTablePickerSelection(
      picker,
      Number(cell.dataset.tableRows),
      Number(cell.dataset.tableColumns),
    );
  };
  const onPointerDown = (event: PointerEvent) => {
    if (
      !picker.hidden &&
      !picker.contains(event.target as Node) &&
      !trigger.contains(event.target as Node)
    ) {
      close();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  picker.addEventListener("pointerover", onPointerOver);
  root.ownerDocument.addEventListener("pointerdown", onPointerDown);
  root.ownerDocument.addEventListener("keydown", onKeyDown);
  session.closeTablePicker = () => {
    close();
  };
  session.unbindTablePicker = () => {
    close();
    picker.removeEventListener("pointerover", onPointerOver);
    root.ownerDocument.removeEventListener("pointerdown", onPointerDown);
    root.ownerDocument.removeEventListener("keydown", onKeyDown);
  };
}

function toggleTablePicker(session: OpenSession) {
  const picker = session.view?.root?.querySelector<HTMLElement>(
    ".zotero-markdown-table-picker",
  );
  const trigger = session.view?.root?.querySelector<HTMLElement>(
    '[data-action="table"]',
  );
  if (!picker || !trigger) return;
  const opening = picker.hidden;
  const moreMenu = session.view?.root?.querySelector<HTMLElement>(
    ".zotero-markdown-more-menu",
  );
  if (moreMenu) moreMenu.hidden = true;
  picker.hidden = !opening;
  trigger.setAttribute("aria-expanded", String(opening));
}

function showUnavailableAction(action: MoreMenuAction) {
  // Some menu actions are still planned; show a localized placeholder.
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({
      text: getString("more-unavailable", {
        args: { label: moreMenuLabel(action) },
      }),
      type: "default",
    })
    .show();
}

async function buildDocumentModalData(
  session: OpenSession,
): Promise<DocumentModalData> {
  const item = Zotero.Items.get(session.itemID);
  const source = session.editor?.getValue() || "";
  if (!item) throw new Error(getString("error-attachment-gone"));
  const size = await IOUtils.stat(session.path)
    .then((info) => info.size ?? null)
    .catch(() => null);
  return {
    title: String(
      item.attachmentFilename || item.getDisplayTitle() || "Note.md",
    ),
    path: session.path,
    size,
    imageCount: parseMarkdownImages(source).length,
    created: item.dateAdded || null,
    modified: item.dateModified || null,
    storageLabel: session.storageLabel,
  };
}

async function openDocumentInfoModal(session: OpenSession) {
  try {
    session.modal?.open("document-info", await buildDocumentModalData(session));
  } catch (error) {
    showModalError(error);
  }
}

async function openRenameModal(session: OpenSession) {
  try {
    session.modal?.open("rename", await buildDocumentModalData(session));
  } catch (error) {
    showModalError(error);
  }
}

async function renameSessionAttachment(session: OpenSession, filename: string) {
  const item = Zotero.Items.get(session.itemID);
  if (!item) throw new Error(getString("error-attachment-gone"));
  const newName = normalizeMarkdownFilename(filename);
  const result = await item.renameAttachmentFile(
    storedMarkdownFilename(newName),
    false,
  );
  if (result === false) throw new Error(getString("error-rename-missing"));
  if (result === -1) throw new Error(getString("error-rename-exists"));
  if (result === -2) throw new Error(getString("error-rename-failed"));
  item.setField("title", newName);
  await item.saveTx({ skipSelect: true });
  const newPath = (await item.getFilePathAsync()) || session.path;
  for (const openSession of sessionRegistry.all()) {
    if (openSession.itemID === session.itemID) openSession.path = newPath;
  }
  ensureTabTitle(session.win, session.tabID, session.itemID);
}

async function revealSessionFolder(session: OpenSession) {
  if (typeof Zotero.File?.reveal === "function") {
    await Zotero.File.reveal(session.path);
    return;
  }
  const parent = PathUtils.parent(session.path);
  if (!parent) throw new Error(getString("error-attachment-directory"));
  Zotero.launchURL(`file://${encodeURI(parent)}`);
}

function saveModalSettings(settings: SettingsModalData) {
  return saveMarkdownSettings(settings);
}

function showModalError(error: unknown) {
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({
      text: error instanceof Error ? error.message : String(error),
      type: "fail",
    })
    .show();
}

async function importExternalImagesInSession(session: OpenSession) {
  try {
    const item = Zotero.Items.get(session.itemID);
    const source = session.editor?.getValue() || "";
    if (!item) throw new Error(getString("error-attachment-gone"));
    const result = await importExternalImages(item, source);
    if (!result.imported) {
      showImageError(new Error("没有可导入的外链图片，或下载失败"));
      return;
    }
    session.editor?.setValue(result.markdown);
    // setValue does not emit a change message, so mark the revision dirty
    // explicitly; otherwise SaveCoordinator skips this write.
    session.save.markChanged();
    session.pendingImageSave = false;
    scheduleAutosave(session);
    await requestSave(session);
    setStatus(
      session,
      "saved",
      getString("status-imported-images", { args: { count: result.imported } }),
    );
  } catch (error) {
    showImageError(error);
  }
}

async function cleanupImagesInSession(session: OpenSession) {
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error(getString("error-attachment-gone"));
    const removed = await cleanupUnusedImageAssets(
      item,
      session.editor?.getValue() || "",
    );
    if (removed) {
      // Zotero detects stored text attachment changes from the main file.
      // Re-save it so asset deletions are included in the next zip upload.
      await requestSave(session, { force: true });
    }
    setStatus(
      session,
      "saved",
      removed
        ? getString("status-cleaned-images", { args: { count: removed } })
        : getString("status-no-unused-images"),
    );
  } catch (error) {
    showImageError(error);
  }
}

function updateModeToggle(session: OpenSession) {
  const button = session.view?.root?.querySelector<HTMLButtonElement>(
    ".zotero-markdown-mode-toggle",
  );
  if (!button) return;
  const state = modeToggleState(session.mode);
  button.innerHTML = iconOnlyButtonHtml(state.icon);
  button.title = state.label;
  button.setAttribute("aria-label", state.label);
  button.setAttribute("aria-pressed", String(session.mode === "source"));
}

function setMode(session: OpenSession, mode: "live" | "source" | "preview") {
  if (mode === "preview") {
    void showReadOnlyPreview(session);
    return;
  }
  session.previewRenderGeneration = (session.previewRenderGeneration ?? 0) + 1;
  session.mode = mode;
  applyModeVisibility(session, mode);
  updateModeToggle(session);
  session.editor?.setMode(mode);
  if (mode === "live") {
    void refreshImageAssets(session);
  }
  setStatus(
    session,
    session.save.dirty ? "dirty" : "saved",
    session.save.dirty
      ? getString("status-unsaved")
      : getString("status-ready"),
  );
  updateMeta(session);
  session.win.requestAnimationFrame(() => {
    session.editor?.focus();
    session.editor?.view.requestMeasure();
  });
}

async function showReadOnlyPreview(session: OpenSession) {
  const generation = (session.previewRenderGeneration ?? 0) + 1;
  session.previewRenderGeneration = generation;
  session.mode = "preview";
  applyModeVisibility(session, "preview");
  updateModeToggle(session);
  const source =
    (await session.editor?.requestSnapshot()) ??
    session.editor?.getValue() ??
    "";
  if (!session.view?.previewEl) return;
  try {
    const rendered = await renderMarkdownAsync({ source });
    if (
      !isCurrentPreviewGeneration(
        generation,
        session.previewRenderGeneration ?? 0,
      ) ||
      session.mode !== "preview" ||
      !session.view.previewEl.isConnected
    ) {
      return;
    }
    mountPreviewHtml(
      session.view.previewEl,
      rendered,
      session.outlineItems || [],
    );
    void hydrateSessionPreviewImages(session, source);
    setStatus(session, "saved", getString("status-preview"));
  } catch (e) {
    ztoolkit.log("Preview render error", e);
    if (session.mode === "preview") {
      const host = session.view.previewEl;
      host.replaceChildren();
      const errorBox = host.ownerDocument.createElement("div");
      errorBox.className = "zotero-markdown-preview-error-state";
      const message = host.ownerDocument.createElement("p");
      message.textContent = previewRenderErrorMessage(e);
      const retry = host.ownerDocument.createElement("button");
      retry.type = "button";
      retry.dataset.action = "preview-retry";
      retry.textContent = getString("preview-retry");
      errorBox.append(message, retry);
      host.appendChild(errorBox);
      setStatus(session, "saved", getString("status-preview"));
    }
  }
  updateMeta(session);
}

function previewRenderErrorMessage(error: unknown): string {
  if (error instanceof AsyncRenderError) {
    if (error.code === "DOCUMENT_TOO_LARGE") {
      return getString("error-preview-too-large");
    }
    if (error.code === "WORKER_RENDER_TIMEOUT") {
      return getString("error-preview-timeout");
    }
    if (error.code === "WORKER_UNAVAILABLE") {
      return getString("error-preview-worker-unavailable");
    }
    return getString("error-preview-worker-failed");
  }
  return getString("error-preview-worker-failed");
}

async function renderedExportHtml(session: OpenSession) {
  const source =
    (await session.editor?.requestSnapshot()) ??
    session.editor?.getValue() ??
    "";
  const item = Zotero.Items.get(session.itemID);
  const assets = item ? await resolveImageAssets(item, source) : {};
  return {
    source,
    html: await buildExportHtml({
      source,
      assets,
      theme: resolveEditorTheme(session.win),
    }),
  };
}

async function exportSessionHtml(session: OpenSession) {
  try {
    const { source, html } = await renderedExportHtml(session);
    const path = await saveHtmlFile(session.win, html, exportBasename(source));
    if (path) setStatus(session, "saved", getString("status-exported-html"));
  } catch (error) {
    showImageError(error);
  }
}

async function exportSessionPdf(session: OpenSession) {
  try {
    const { html } = await renderedExportHtml(session);
    if (!openPrintableDocument(session.win, html)) {
      throw new Error(getString("error-print-window"));
    }
    setStatus(session, "info", getString("status-print-pdf"));
  } catch (error) {
    showImageError(error);
  }
}

function showImageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  ztoolkit.log("Markdown image operation failed", error);
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text: message, type: "fail" })
    .show();
}

async function chooseAndInsertImage(session: OpenSession) {
  const item = Zotero.Items.get(session.itemID);
  if (!item || !item.isStoredFileAttachment?.()) {
    showImageError(new Error(getString("error-stored-image-only")));
    return;
  }
  const doc = session.view?.root?.ownerDocument;
  if (!doc) return;
  const input = doc.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.hidden = true;
  session.view?.root?.appendChild(input);
  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      if (file) {
        void file
          .arrayBuffer()
          .then((bytes) =>
            insertImageBytes(session, new Uint8Array(bytes), file.type),
          )
          .catch(showImageError);
      }
      input.remove();
    },
    { once: true },
  );
  input.click();
}

async function insertImageBytes(
  session: OpenSession,
  bytes: Uint8Array,
  mimeType: string,
) {
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error(getString("error-attachment-gone"));
    const reference = await writeImageAsset(item, bytes, mimeType);
    session.pendingImageSave = true;
    session.editor?.insertText(`![](${reference})`, 2, 2);
    const asset = await resolveImageAssetEntry(item, reference);
    // Single-asset push: merge so already-loaded images stay resolved.
    session.editor?.setImageAssets({ [reference]: asset }, false);
  } catch (error) {
    session.pendingImageSave = false;
    showImageError(error);
  }
}

function scheduleImageAssetRefresh(session: OpenSession) {
  if (session.mode !== "preview") return;
  if (session.imageRefreshTimer)
    session.win.clearTimeout(session.imageRefreshTimer);
  session.imageRefreshTimer = session.win.setTimeout(() => {
    void refreshImageAssets(session);
  }, 250) as unknown as number;
}

async function refreshImageAssets(session: OpenSession) {
  const item = Zotero.Items.get(session.itemID);
  if (!item || !session.editor) {
    Zotero.debug(
      `[Bamboo][ImageDebug] asset-refresh-skipped ${JSON.stringify({
        hasItem: !!item,
        hasEditor: !!session.editor,
        mode: session.mode,
      })}`,
    );
    return;
  }
  Zotero.debug(
    `[Bamboo][ImageDebug] asset-refresh-start ${JSON.stringify({
      mode: session.mode,
      itemID: session.itemID,
    })}`,
  );
  try {
    const assets = await resolveImageAssets(item, session.editor.getValue());
    if (sessionRegistry.get(session.tabID) !== session) {
      Zotero.debug("[Bamboo][ImageDebug] asset-refresh-stale-session");
      return;
    }
    const summary = Object.fromEntries(
      Object.entries(assets).map(([reference, asset]) => [
        reference,
        asset.error ? `error: ${asset.error}` : "ready",
      ]),
    );
    Zotero.debug(
      `[Bamboo][ImageDebug] asset-refresh-complete ${JSON.stringify({
        mode: session.mode,
        assets: summary,
      })}`,
    );
    session.editor.setImageAssets(assets);
    if (session.mode === "preview" && session.view?.previewEl) {
      hydratePreviewImages(session.view.previewEl, assets);
    }
  } catch (error) {
    Zotero.debug(`[Bamboo][ImageDebug] asset-refresh-error ${String(error)}`);
    ztoolkit.log("Failed to refresh markdown image assets", error);
  }
}

async function hydrateSessionPreviewImages(
  session: OpenSession,
  source: string,
) {
  const item = Zotero.Items.get(session.itemID);
  if (!item || !session.view?.previewEl) return;
  const assets = await resolveImageAssets(item, source);
  if (session.mode !== "preview" || !session.view.previewEl) return;
  hydratePreviewImages(session.view.previewEl, assets);
  session.editor?.setImageAssets(assets);
}

function scheduleAutosave(session: OpenSession) {
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
  }
  if (session.titleSyncTimer) {
    session.win.clearTimeout(session.titleSyncTimer);
    session.titleSyncTimer = undefined;
    const value = session.editor?.getValue();
    const headingTitle = value ? extractFirstHeadingTitle(value) : null;
    const change =
      value && headingTitle
        ? frontmatterTitleChange(value, headingTitle)
        : null;
    if (value && change) {
      // Targeted replace (same as applyTitleSync) instead of a full
      // setValue, which would wipe the CodeMirror undo history.
      session.editor?.replaceRange(change.from, change.to, change.insert);
    }
  }
  session.autosaveTimer = session.win.setTimeout(() => {
    void requestSave(session);
  }, AUTOSAVE_MS) as unknown as number;
}

function scheduleTitleSync(session: OpenSession) {
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
    session.autosaveTimer = undefined;
  }
  if (session.titleSyncTimer) {
    session.win.clearTimeout(session.titleSyncTimer);
  }
  session.titleSyncTimer = session.win.setTimeout(() => {
    session.titleSyncTimer = undefined;
    applyTitleSync(session);
  }, TITLE_SYNC_MS) as unknown as number;
}

function flushTitleSync(session: OpenSession) {
  if (session.titleSyncTimer) {
    session.win.clearTimeout(session.titleSyncTimer);
    session.titleSyncTimer = undefined;
  }
  applyTitleSync(session);
}

function applyTitleSync(session: OpenSession) {
  const value = session.editor?.getValue();
  if (value === undefined) return;
  const headingTitle = extractFirstHeadingTitle(value);
  const change = headingTitle
    ? frontmatterTitleChange(value, headingTitle)
    : null;
  if (!change) {
    const force = !!session.pendingExplicitSave;
    const cleanupImages = !!session.pendingImageCleanup;
    session.pendingExplicitSave = false;
    session.pendingImageCleanup = false;
    void requestSave(session, { force, cleanupImages });
    return;
  }
  session.applyingTitleSync = true;
  session.editor?.replaceRange(change.from, change.to, change.insert);
}

function createSessionSave(session: OpenSession) {
  return new SaveCoordinator({
    getSnapshot: async () => ({
      rev: session.save.currentRev,
      value:
        (await session.editor?.requestSnapshot()) ??
        session.editor?.getValue() ??
        "",
    }),
    write: (value, request) => persistSession(session, value, request),
    onStateChange: () => updateSaveStatus(session),
  });
}

function requestSave(
  session: OpenSession,
  opts: { force?: boolean; cleanupImages?: boolean } = {},
) {
  return session.save.request(opts).catch((error) => {
    ztoolkit.log("Failed to save markdown", error);
    setStatus(session, "error", getString("status-save-failed"));
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        type: "fail",
      })
      .show();
  });
}

async function persistSession(
  session: OpenSession,
  value: string,
  opts: { force: boolean; cleanupImages: boolean },
) {
  const item = Zotero.Items.get(session.itemID);
  if (!item) throw new Error("Item gone");
  const { path, titleChanged } = await persistMarkdownContent(item, value, {
    cleanupImages: opts.cleanupImages,
    syncTitle: true,
  });
  if (session.documentSyncSourceID) {
    documentSyncRegistry.markSaved(session.documentSyncSourceID);
  }
  session.path = path;
  if (titleChanged) {
    ensureTabTitle(session.win, session.tabID, session.itemID);
  }
  session.savedAt = new Date();
  setStatus(
    session,
    "saved",
    opts.force ? getString("status-saved") : getString("status-auto-saved"),
  );
  updateMeta(session);
}

export type SaveStatusKind = "saved" | "dirty" | "error" | "info";

/**
 * Set the status-bar text with an explicit state kind. The kind drives the
 * CSS state classes — never string-matching the (possibly localized) text,
 * which would break as soon as translations are wired in.
 */
function setStatus(session: OpenSession, kind: SaveStatusKind, text: string) {
  const statusEl = session.view?.saveStatusEl;
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove("is-dirty", "is-saved", "is-error");
  if (kind === "error") {
    statusEl.classList.add("is-error");
  } else if (kind === "dirty") {
    statusEl.classList.add("is-dirty");
  } else {
    statusEl.classList.add("is-saved");
  }
}

function updateMeta(session: OpenSession) {
  if (!session.view?.metaEl) return;
  const stats = session.editor?.getStats() || {
    chars: 0,
    lines: 0,
    words: 0,
  };
  session.view.metaEl.textContent = formatStats(stats);
}

function updateSaveStatus(session: OpenSession) {
  const statusEl = session.view?.saveStatusEl;
  if (!statusEl) return;

  statusEl.classList.remove("is-dirty", "is-saved", "is-error");
  if (session.save.writing) {
    statusEl.textContent = getString("status-saving");
    statusEl.classList.add("is-dirty");
  } else if (session.save.lastError) {
    statusEl.textContent = getString("status-save-failed");
    statusEl.classList.add("is-error");
  } else if (session.save.dirty) {
    statusEl.textContent = getString("status-unsaved-changes");
    statusEl.classList.add("is-dirty");
  } else if (session.savedAt) {
    statusEl.textContent = formatSavedStatus(session.savedAt);
    statusEl.classList.add("is-saved");
  } else {
    statusEl.textContent = getString("status-autosave-on");
    statusEl.classList.add("is-saved");
  }
}

async function closeSession(tabID: string, opts: { flush?: boolean } = {}) {
  const session = sessionRegistry.get(tabID);
  if (!session) return;
  if (session.closing) {
    await session.closePromise;
    return;
  }

  session.closing = true;
  session.closePromise = (async () => {
    session.closeMoreMenu?.();
    session.modal?.destroy();
    session.unbindTablePicker?.();
    if (session.autosaveTimer) {
      session.win.clearTimeout(session.autosaveTimer);
    }

    if (opts.flush) {
      // Rewriting the main attachment lets Zotero include sidecar deletions in
      // the next stored-file sync, even when autosave already cleared `dirty`.
      await requestSave(session, { force: true, cleanupImages: true });
    }

    try {
      session.unbindTheme?.();
    } catch {
      // ignore
    }
    try {
      session.unbindDocumentSync?.();
    } catch {
      // ignore
    }
    session.outlineSidebar?.destroy();
    session.editor?.destroy();
    sessionRegistry.unregister(tabID);
  })();
  await session.closePromise;
}

/** Close (and flush) an open Markdown tab by its tabID. */
export async function closeMarkdownTab(tabID: string): Promise<boolean> {
  const session = sessionRegistry.get(tabID);
  if (!session) return false;
  await closeSession(tabID, { flush: true });
  return true;
}

export async function flushSessionsForWindow(win: Window) {
  await Promise.all(
    sessionRegistry
      .sessionsForWindow(win)
      .map((session) => closeSession(session.tabID, { flush: true })),
  );
}

export async function flushAllSessions() {
  await Promise.all(
    sessionRegistry
      .all()
      .map((session) => closeSession(session.tabID, { flush: true })),
  );
}
