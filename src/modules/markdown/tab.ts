import {
  documentWorkspace,
  rememberDocument,
  forgetOpenDocument,
} from "../workspace-state";
import { showNoteSearch } from "./search";
import { showFileHistory } from "../file-history-ui";
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
  iconMore,
  iconOnlyButtonHtml,
  iconPanelLeft,
  iconPanelRight,
  iconRedo,
  iconSave,
  iconSource,
  iconTable,
  iconTask,
  iconUndo,
} from "./icons";
import {
  mountResponsiveToolbar,
  type ResponsiveToolbar,
  type ToolbarCommand,
} from "./responsive-toolbar";
import { tableInsertTemplate } from "./insert-template";
import {
  EDITOR_MODE_OPTIONS,
  EXPORT_OPTIONS,
  submenuPosition,
  MORE_MENU_SECTIONS,
  modeLabel,
  moreMenuLabel,
  type MoreMenuAction,
} from "./more-menu";
import {
  activePreviewOutlineID,
  hydratePreviewImages,
  mountPreviewHtml,
  scrollPreviewToOutline,
  scrollPreviewToFragment,
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
  importExternalImages,
  resolveImageAssetEntry,
  resolveImageAssets,
  writeImageAsset,
} from "./images/service";
import { parseMarkdownImages } from "./images/model";
import {
  createMarkdownModalController,
  type DocumentModalData,
  type SettingsModalData,
} from "./modal";
import { renameMarkdownAttachment } from "./rename";
import { markdownSettingsAbout, saveMarkdownSettings } from "./settings";
import { formatSavedStatus, formatStats } from "./status";
import { MARKDOWN_TAB_TYPE, resolveMarkdownTabTitle } from "./tabHooks";
import { SaveCoordinator } from "./save-coordinator";
import { persistMarkdownContent } from "./persist";
import {
  sessionRegistry,
  type OpenSession,
  type SessionSurface,
  type SessionView,
} from "./session-registry";
import { ensureDOMGlobals, getDOMDocument } from "../../utils/dom";
import { getString } from "../../utils/locale";
import type { EditorOutlineItem, EditorTheme } from "./editor-protocol";
import { mountOutlineSidebar } from "./outline-sidebar";
import { documentSyncRegistry } from "./document-sync";
import { navigateDocumentLink, searchDocumentLinks } from "./document-links";
import { switchMarkdownSurface } from "./window";
import { mountBacklinksSidebar, mountNoteBacklinks } from "./backlinks";
import { noteHeadingPosition, type PortableNote } from "./note-links";
import { invalidateNoteLibrary, updateIndexedNote } from "./note-library";
import { exportNoteLibrary } from "./export-notes";

const responsiveToolbars = new WeakMap<OpenSession, ResponsiveToolbar>();
const tablePickerAnchors = new WeakMap<OpenSession, HTMLElement>();
const readOnlySessions = new WeakSet<OpenSession>();
const AUTOSAVE_MS = 800;
const TITLE_SYNC_MS = 1000;
const metaUpdateTimers = new WeakMap<OpenSession, number>();
const titleSaveOwners = new WeakMap<OpenSession, object>();

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

export interface MarkdownEditorSurfaceOptions {
  sessionID: string;
  surface: SessionSurface;
  item: Zotero.Item;
  path: string;
  content: string;
  storageLabel: string;
  win: Window;
  container: HTMLElement;
  isActive: () => boolean;
  updateTitle: () => void;
}

export function mountMarkdownEditorSurface(
  options: MarkdownEditorSurfaceOptions,
): OpenSession {
  const session: OpenSession = {
    tabID: options.sessionID,
    surface: options.surface,
    sourceID: `${options.surface}:${options.sessionID}`,
    itemID: options.item.id,
    path: options.path,
    fileRevision: { content: options.content },
    mode: "live",
    previewRenderGeneration: 0,
    outlineItems: [],
    outlineActiveID: null,
    outlineExpanded: true,
    storageLabel: options.storageLabel,
    win: options.win,
    isActive: options.isActive,
    updateTitle: options.updateTitle,
    save: null as unknown as SaveCoordinator,
  };
  session.save = createSessionSave(session);
  sessionRegistry.register(session);
  rememberDocument(session.itemID, {
    kind: "markdown",
    surface: session.surface,
    open: true,
  });
  try {
    mountEditorUI(
      options.win,
      options.container,
      session,
      options.content,
      options.item,
    );
    const restored = documentWorkspace(session.itemID);
    void session.editor?.ready.then(async () => {
      if (session.closing) return;
      if (restored?.mode === "preview") {
        await showReadOnlyPreview(session);
        if (session.view)
          session.view.previewEl.scrollTop = restored.previewScroll ?? 0;
      } else if (restored?.mode === "source") setMode(session, "source");
    });
    options.updateTitle();
    return session;
  } catch (error) {
    sessionRegistry.unregister(options.sessionID);
    throw error;
  }
}

/**
 * Open (or focus) a Markdown editor tab for an attachment item.
 */
export async function openMarkdownTab(
  item: Zotero.Item,
  options: {
    win?: _ZoteroTypes.MainWindow;
    shouldOpen?: () => boolean;
  } = {},
): Promise<string | null> {
  const win =
    options.win ||
    (Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined);
  if (!win) {
    ztoolkit.log("No main window for Markdown tab");
    return null;
  }
  if (options.shouldOpen?.() === false) return null;

  ensureDOMGlobals(win);

  const existing = sessionRegistry.find(win, item.id, "tab");
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
      void refreshMarkdownSessionOnFocus(existing);
      existing.editor?.focus();
      return existing.tabID;
    }
    sessionRegistry.unregister(existing.tabID);
  }

  const path = await item.getFilePathAsync();
  if (options.shouldOpen?.() === false) return null;
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
    if (options.shouldOpen?.() === false) return null;
    ztoolkit.log("Failed to read markdown file", e);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Failed to read markdown file", type: "fail" })
      .show();
    return null;
  }

  if (options.shouldOpen?.() === false) return null;
  const title = await resolveMarkdownTabTitle(item.id);
  if (options.shouldOpen?.() === false) return null;
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
      void closeMarkdownSession(tabID, { flush: true });
    },
  });

  const host = container as unknown as HTMLElement;
  host.classList.add("zotero-markdown-tab-content");
  try {
    host.setAttribute("flex", "1");
  } catch {
    // ignore
  }

  try {
    mountMarkdownEditorSurface({
      sessionID: tabID,
      surface: "tab",
      item,
      path,
      content,
      storageLabel,
      win,
      container: host,
      isActive: () => win.Zotero_Tabs.selectedID === tabID,
      updateTitle: () => ensureTabTitle(win, tabID, item.id),
    });
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
function bindSessionTheme(win: Window, session: OpenSession) {
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

  const sourceID = session.sourceID;
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
      const value = typeof raw === "string" ? raw : String(raw ?? "");
      const item = Zotero.Items.get(session.itemID);
      if (item) updateIndexedNote(item, value);
      return value;
    },
    applyPersisted: (value) => applyPersistedToSession(session, value),
  });

  const editorHost = session.view?.editorHost;
  const onEditorFocus = () => {
    void refreshMarkdownSessionOnFocus(session);
  };
  const onWindowFocus = () => {
    void refreshMarkdownSessionOnFocus(session);
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

export function refreshMarkdownSessionOnFocus(
  session: OpenSession,
): Promise<void> {
  if (
    session.closing ||
    !session.editor ||
    !session.documentSyncSourceID ||
    !session.isActive()
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
  session.fileRevision = { content: value };
  if (editor.getValue() === value) return;

  editor.setValue(value);
  session.save.adoptPersistedSnapshot();
  updateMeta(session);
  updateSaveStatus(session);
  session.updateTitle();
  if (session.mode === "preview") {
    void showReadOnlyPreview(session);
  } else {
    void refreshImageAssets(session);
  }
}

function mountEditorUI(
  win: Window,
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
        attributes: { "data-toolbar-layout": "compact" },
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
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-toolbar-actions"],
                children: [
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
                    classList: [
                      "zotero-markdown-btn",
                      "zotero-markdown-backlinks-toggle",
                    ],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconPanelRight()),
                    },
                    attributes: {
                      title: getString("note-backlinks-toggle"),
                      "aria-label": getString("note-backlinks-toggle"),
                      "aria-expanded": "true",
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn", "zotero-markdown-more"],
                    properties: {
                      type: "button",
                      innerHTML: iconOnlyButtonHtml(iconMore()),
                    },
                    attributes: {
                      "data-action": "more",
                      "aria-haspopup": "true",
                      "aria-expanded": "false",
                      title: getString("tab-more"),
                      "aria-label": getString("tab-more"),
                    },
                  },
                ],
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
                classList: ["zotero-markdown-sidebar-title"],
                properties: { innerText: getString("markdown-outline-title") },
              },
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
          {
            tag: "aside",
            namespace: "html",
            classList: ["zotero-markdown-backlinks-sidebar"],
            attributes: {
              id: `${session.tabID}-backlinks`,
              "aria-label": getString("note-backlinks-title"),
            },
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
  if (toolbar) {
    root.querySelector(".zotero-markdown-workspace")?.prepend(toolbar);
  }
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
      if (
        session.mode === "preview" ||
        readOnlySessions.has(session) ||
        session.editor?.isComposing()
      )
        return;
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
    else if (isToolbarCommand(action))
      executeToolbarCommand(session, action, btn);
    else if (action === "mode-toggle") {
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
    backlinksSidebarEl: root.querySelector(
      ".zotero-markdown-backlinks-sidebar",
    ) as HTMLElement,
    backlinksToggleEl: root.querySelector(
      ".zotero-markdown-backlinks-toggle",
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
  const onNavigateNote = (
    note: PortableNote,
    heading?: string,
    position?: number,
  ) => {
    if (note.key !== item.key || note.libraryID !== item.libraryID)
      return false;
    const from =
      position ??
      (heading
        ? noteHeadingPosition(session.editor?.getValue() ?? content, heading)
        : 0);
    if (from === null) throw new Error(getString("note-heading-missing"));
    revealMarkdownSessionPosition(session, from);
    return true;
  };
  const navigateLink = (href: string) =>
    navigateDocumentLink(item, win, href, { onNavigateNote });
  const unbindBacklinksSidebar = mountBacklinksSidebar(
    view.root,
    view.backlinksSidebarEl,
    view.backlinksToggleEl,
    () => session.editor?.view.requestMeasure(),
  );
  const unbindBacklinks = mountNoteBacklinks(
    view.backlinksSidebarEl,
    item,
    win,
    { onNavigateNote, fullHeight: true },
  );
  session.unbindBacklinks = () => {
    unbindBacklinksSidebar();
    unbindBacklinks();
  };
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
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a");
    const wiki = target?.closest?.("[data-zmd-wikilink]");
    const href =
      anchor?.getAttribute("href") ||
      (wiki?.getAttribute("data-zmd-wikilink")
        ? `[[${wiki.getAttribute("data-zmd-wikilink") || ""}]]`
        : null);
    if (!href) return;
    event.preventDefault();
    if (!scrollPreviewToFragment(view.previewEl, href)) navigateLink(href);
  });
  view.previewEl.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Enter") return;
    const target = event.target as Element | null;
    const wiki = target?.closest?.("[data-zmd-wikilink]");
    const name = wiki?.getAttribute("data-zmd-wikilink");
    if (!name) return;
    event.preventDefault();
    navigateLink(`[[${name}]]`);
  });
  const readOnly = !item.isEditable();
  if (readOnly) readOnlySessions.add(session);
  bindTablePicker(session);
  mountMoreMenu(session);
  responsiveToolbars.set(
    session,
    mountResponsiveToolbar({
      root,
      workspace: view.workspaceEl,
      labels: {
        heading: getString("tab-toolbar-heading"),
        format: getString("tab-toolbar-format"),
        insert: getString("tab-toolbar-insert"),
      },
      isComposing: () => !!session.editor?.isComposing(),
      onCommand: (command, anchor) =>
        executeToolbarCommand(session, command, anchor),
      closeOtherMenus: () => {
        closeToolbarMoreMenu(session);
        session.closeTablePicker?.();
      },
    }),
  );

  applyModeVisibility(session, "live");

  session.editor = createMarkdownEditor(view.editorHost, {
    doc: content ?? "",
    viewState: documentWorkspace(session.itemID)?.view,
    onViewState: (view) => rememberDocument(session.itemID, { view }),
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
    onCompositionChange: (active) => {
      if (active) {
        pauseDocumentTimers(session);
        cancelMetaUpdate(session);
      } else if (!session.closing) {
        scheduleMetaUpdate(session);
        if (session.titleSyncPending) scheduleTitleSync(session);
        if (session.save.dirty) scheduleAutosave(session);
      }
    },
    onChange: (value) => {
      const appliedTitleSync = !!session.applyingTitleSync;
      session.applyingTitleSync = false;
      session.save.markChanged();
      if (session.documentSyncSourceID) {
        documentSyncRegistry.markEdited(session.documentSyncSourceID);
      }
      setStatus(session, "dirty", getString("status-unsaved"));
      scheduleMetaUpdate(session);
      scheduleImageAssetRefresh(session);
      if (appliedTitleSync) {
        const force = !!session.pendingExplicitSave;
        session.pendingExplicitSave = false;
        const saveAlreadyRequested = titleSaveOwners.delete(session);
        if (!session.closing && !saveAlreadyRequested)
          void requestSave(session, { force });
      } else {
        scheduleTitleSync(session);
        scheduleAutosave(session);
      }
      if (session.pendingImageSave) {
        session.pendingImageSave = false;
        void requestSave(session);
      }
    },
    onSave: () => {
      if (!session.editor?.isComposing() && session.titleSyncPending) {
        session.pendingExplicitSave = true;
        flushTitleSync(session);
      } else {
        void requestSave(session, { force: true });
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
    onLinkSearch: (query, filter) =>
      searchDocumentLinks(item, query, false, {
        filter,
        win,
        currentContent: session.editor?.getValue() ?? content,
      }),
    onOpenLink: navigateLink,
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
  session.outlineActiveID = item.id;
  session.outlineSidebar?.setActive(item.id);
  if (session.mode === "preview" && session.view?.previewEl) {
    scrollPreviewToOutline(session.view.previewEl, item.id);
    return;
  }
  session.editor?.revealPosition(item.from);
}

/** Reveal a link destination in the visible surface, including preview tabs. */
export function revealMarkdownSessionPosition(
  session: OpenSession,
  position: number,
): void {
  const heading = session.outlineItems?.find(
    (entry) => entry.from === position,
  );
  if (session.mode === "preview" && heading)
    navigateToOutlineItem(session, heading);
  else {
    if (session.mode === "preview") setMode(session, "live");
    session.editor?.revealPosition(position);
  }
}

function applyModeVisibility(
  session: OpenSession,
  mode: "live" | "source" | "preview",
) {
  if (mode !== "preview") {
    session.unbindPreviewOutline?.();
    session.unbindPreviewOutline = undefined;
  }
  const root = session.view?.root;
  const editorHost = session.view?.editorHost;
  const previewEl = session.view?.previewEl;

  const readOnly = readOnlySessions.has(session);
  responsiveToolbars
    .get(session)
    ?.updateMode(mode === "preview" || readOnly, !readOnly);
  if (root) {
    for (const entry of root.querySelectorAll<HTMLButtonElement>(
      '[data-menu-action="redo"], [data-menu-action="save"]',
    ))
      entry.disabled =
        readOnly || (mode === "preview" && entry.dataset.menuAction === "redo");
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

function bindPreviewOutlineTracking(session: OpenSession): void {
  session.unbindPreviewOutline?.();
  const host = session.view?.previewEl;
  if (!host) return;
  let frame: number | null = null;
  let viewSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let previewScroll = host.scrollTop;

  const publish = () => {
    frame = null;
    if (session.closing || session.mode !== "preview" || !host.isConnected) {
      return;
    }
    const headings = Array.from(
      host.querySelectorAll<HTMLElement>("[data-zmd-outline-id]"),
    ).flatMap((heading) => {
      const id = heading.dataset.zmdOutlineId;
      return id ? [{ id, top: heading.getBoundingClientRect().top }] : [];
    });
    previewScroll = host.scrollTop;
    clearTimeout(viewSaveTimer);
    viewSaveTimer = setTimeout(
      () => rememberDocument(session.itemID, { previewScroll }),
      200,
    );
    const rect = host.getBoundingClientRect();
    const atBottom =
      host.scrollTop + host.clientHeight >= host.scrollHeight - 2;
    const activeID = atBottom
      ? (headings.at(-1)?.id ?? null)
      : activePreviewOutlineID(headings, rect.top + rect.height * 0.5);
    if (activeID === session.outlineActiveID) return;
    session.outlineActiveID = activeID;
    session.outlineSidebar?.setActive(activeID);
  };
  const schedule = () => {
    if (frame != null) return;
    frame = session.win.requestAnimationFrame(publish);
  };
  host.addEventListener("scroll", schedule, { passive: true });
  session.unbindPreviewOutline = () => {
    host.removeEventListener("scroll", schedule);
    if (viewSaveTimer !== undefined) {
      clearTimeout(viewSaveTimer);
      rememberDocument(session.itemID, { previewScroll });
    }
    if (frame != null) session.win.cancelAnimationFrame(frame);
    frame = null;
  };
  schedule();
}

function isToolbarCommand(action: string | null): action is ToolbarCommand {
  return [
    "save",
    "undo",
    "redo",
    "bold",
    "italic",
    "h1",
    "h2",
    "h3",
    "list",
    "task",
    "code",
    "link",
    "table",
    "image",
  ].includes(action || "");
}

function executeToolbarCommand(
  session: OpenSession,
  action: ToolbarCommand,
  anchor?: HTMLElement,
) {
  if (action !== "save" && session.editor?.isComposing()) return;
  if (
    readOnlySessions.has(session) ||
    (session.mode === "preview" && action !== "save")
  )
    return;
  if (action === "save") void requestSave(session, { force: true });
  else if (action === "undo" || action === "redo")
    session.editor?.command(action);
  else if (action === "bold") session.editor?.wrapSelection("**");
  else if (action === "italic") session.editor?.wrapSelection("*");
  else if (action === "h1") session.editor?.prefixLine("# ");
  else if (action === "h2") session.editor?.prefixLine("## ");
  else if (action === "h3") session.editor?.prefixLine("### ");
  else if (action === "list") session.editor?.prefixLine("- ");
  else if (action === "task") session.editor?.prefixLine("- [ ] ");
  else if (action === "code") session.editor?.wrapSelection("`");
  else if (action === "link") session.editor?.wrapSelection("[", "](url)");
  else if (action === "table") toggleTablePicker(session, anchor);
  else if (action === "image") void chooseAndInsertImage(session);
}

function closeToolbarMoreMenu(session: OpenSession) {
  const root = session.view?.root;
  const menu = root?.querySelector<HTMLElement>(".zotero-markdown-more-menu");
  if (menu) menu.hidden = true;
  root
    ?.querySelector('[data-action="more"]')
    ?.setAttribute("aria-expanded", "false");
  for (const panel of root?.querySelectorAll<HTMLElement>(
    ".zotero-markdown-mode-submenu, .zotero-markdown-export-submenu",
  ) || [])
    panel.hidden = true;
  for (const trigger of menu?.querySelectorAll('[aria-haspopup="menu"]') || [])
    trigger.setAttribute("aria-expanded", "false");
}

export function mountMoreMenu(session: OpenSession) {
  const root = session.view?.root;
  if (!root) return;
  const menu = root.querySelector(".zotero-markdown-more-menu") as HTMLElement;
  if (!menu) return;

  menu.replaceChildren();
  for (const action of ["save", "redo"] as const) {
    const button = menu.ownerDocument.createElement("button");
    button.type = "button";
    button.className =
      "zotero-markdown-more-menu-item zotero-markdown-compact-action";
    button.dataset.menuAction = action;
    button.textContent = getString(action === "save" ? "tab-save" : "tab-redo");
    menu.append(button);
  }
  const compactSeparator = menu.ownerDocument.createElement("div");
  compactSeparator.className =
    "zotero-markdown-more-menu-separator zotero-markdown-compact-action";
  menu.append(compactSeparator);
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
      button.append(
        item.action === "open-window" && session.surface === "window"
          ? getString("more-open-tab")
          : moreMenuLabel(item.action),
      );
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
      if (item.submenu) {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-haspopup", "menu");
      }
      menu.appendChild(button);
      if (item.action === "mode") {
        menu.appendChild(createModeSubmenu(menu.ownerDocument));
      } else if (item.action === "export") {
        const panel = menu.ownerDocument.createElement("div");
        panel.className = "zotero-markdown-export-submenu";
        panel.hidden = true;
        panel.setAttribute("role", "menu");
        for (const option of EXPORT_OPTIONS) {
          const entry = menu.ownerDocument.createElement("button");
          entry.type = "button";
          entry.className = "zotero-markdown-more-menu-item";
          entry.dataset.menuAction = option.action;
          entry.textContent = option.label;
          entry.setAttribute("role", "menuitem");
          panel.append(entry);
        }
        menu.append(panel);
      }
    }
  });

  const modeButton = menu.querySelector<HTMLElement>(
    '[data-menu-action="mode"]',
  );
  const modeMenu = menu.querySelector<HTMLElement>(
    ".zotero-markdown-mode-submenu",
  );

  const exportMenu = menu.querySelector<HTMLElement>(
    ".zotero-markdown-export-submenu",
  );
  const exportButton = menu.querySelector<HTMLElement>(
    '[data-menu-action="export"]',
  );
  const collapseModeMenu = () => {
    if (modeMenu) modeMenu.hidden = true;
    if (exportMenu) exportMenu.hidden = true;
    modeButton?.setAttribute("aria-expanded", "false");
    exportButton?.setAttribute("aria-expanded", "false");
  };
  const openSubmenu = (action: "mode" | "export") => {
    const panel = action === "mode" ? modeMenu : exportMenu;
    const trigger = action === "mode" ? modeButton : exportButton;
    if (!panel || !trigger) return;
    const opening = panel.hidden;
    collapseModeMenu();
    if (!opening) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (action === "mode") syncModeSubmenu(session, panel);
    const bounds = root.getBoundingClientRect();
    panel.style.maxHeight = `${Math.max(32, bounds.height - 8)}px`;
    panel.style.maxWidth = `${Math.max(32, bounds.width - 8)}px`;
    const rect = panel.getBoundingClientRect();
    const position = submenuPosition(
      menu.getBoundingClientRect(),
      rect.width,
      rect.height,
      bounds,
    );
    position.top = submenuPosition(
      trigger.getBoundingClientRect(),
      rect.width,
      rect.height,
      bounds,
    ).top;
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
  };
  const close = () => {
    menu.hidden = true;
    root
      .querySelector('[data-action="more"]')
      ?.setAttribute("aria-expanded", "false");
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
    if (action === "save" || action === "redo") {
      executeToolbarCommand(session, action);
      close();
      return;
    }
    if (action === "open-window") {
      close();
      void switchMarkdownSurface(session).catch((error) => {
        ztoolkit.log("Failed to switch Markdown window", error);
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({ text: getString("error-open-window"), type: "fail" })
          .show();
      });
      return;
    }
    if (action === "mode" || action === "export") {
      openSubmenu(action);
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
    if (action === "search-library") {
      close();
      const item = Zotero.Items.get(session.itemID);
      if (item)
        void showNoteSearch(session.win, item).catch((error) =>
          session.win.alert(String(error)),
        );
      return;
    }
    if (action === "history") {
      close();
      const item = Zotero.Items.get(session.itemID);
      if (item)
        void showFileHistory(session.win, item).catch((error) => {
          ztoolkit.log("Failed to open history", error);
          session.win.alert(String(error));
        });
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
    if (action === "export-obsidian" || action === "export-markdown") {
      void exportSessionNotes(
        session,
        action === "export-obsidian" ? "wiki" : "markdown",
      );
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
    if (menu.hidden) return;
    const active = menu.ownerDocument.activeElement as HTMLElement | null;
    const panel =
      modeMenu && !modeMenu.hidden
        ? modeMenu
        : exportMenu && !exportMenu.hidden
          ? exportMenu
          : null;
    if ((event.key === "Escape" || event.key === "ArrowLeft") && panel) {
      event.preventDefault();
      const trigger = panel === modeMenu ? modeButton : exportButton;
      collapseModeMenu();
      trigger?.focus();
    } else if (
      event.key === "ArrowRight" &&
      (active === modeButton || active === exportButton)
    ) {
      event.preventDefault();
      openSubmenu(active === modeButton ? "mode" : "export");
      (active === modeButton ? modeMenu : exportMenu)
        ?.querySelector<HTMLElement>("button")
        ?.focus();
    } else if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      active &&
      menu.contains(active)
    ) {
      event.preventDefault();
      const buttons = [
        ...(panel && panel.contains(active) ? panel : menu).children,
      ].filter(
        (el) =>
          el.tagName.toLowerCase() === "button" &&
          !(el as HTMLButtonElement).disabled &&
          root.ownerDocument.defaultView?.getComputedStyle(el)?.display !==
            "none",
      ) as HTMLElement[];
      const index = buttons.indexOf(active);
      buttons[
        (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    } else if (event.key === "Escape") {
      close();
      root.querySelector<HTMLElement>('[data-action="more"]')?.focus();
    }
  };
  root.ownerDocument.defaultView?.addEventListener("resize", collapseModeMenu);
  menu.addEventListener("click", onMenuClick);
  root.ownerDocument.addEventListener("pointerdown", onPointerDown);
  root.ownerDocument.addEventListener("keydown", onKeyDown);
  session.closeMoreMenu = () => {
    close();
    root.ownerDocument.defaultView?.removeEventListener(
      "resize",
      collapseModeMenu,
    );
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
  submenu.setAttribute("role", "menu");
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
  responsiveToolbars.get(session)?.close();
  const opening = menu.hidden;
  menu.hidden = !opening;
  session.view?.root
    .querySelector('[data-action="more"]')
    ?.setAttribute("aria-expanded", String(opening));
  const modeMenu = menu.querySelector<HTMLElement>(
    ".zotero-markdown-mode-submenu",
  );
  const modeButton = menu.querySelector<HTMLElement>(
    '[data-menu-action="mode"]',
  );
  for (const panel of menu.querySelectorAll<HTMLElement>(
    ".zotero-markdown-mode-submenu, .zotero-markdown-export-submenu",
  ))
    panel.hidden = true;
  for (const trigger of menu.querySelectorAll<HTMLElement>(
    '[aria-haspopup="menu"]',
  ))
    trigger.setAttribute("aria-expanded", "false");
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
  // Keep the shared picker outside the full-width-only table button wrapper.
  root.querySelector(".zotero-markdown-toolbar-inner")?.append(picker);
  updateTablePickerSelection(picker, 3, 3);

  const close = () => {
    picker.hidden = true;
    (tablePickerAnchors.get(session) || trigger).setAttribute(
      "aria-expanded",
      "false",
    );
    tablePickerAnchors.delete(session);
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
      !(tablePickerAnchors.get(session) || trigger).contains(
        event.target as Node,
      )
    ) {
      close();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !picker.hidden &&
      event.key === "Escape" &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      const anchor = tablePickerAnchors.get(session) || trigger;
      close();
      if (!session.editor?.isComposing()) anchor.focus();
    }
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

function toggleTablePicker(session: OpenSession, anchor?: HTMLElement) {
  const root = session.view?.root;
  const picker = root?.querySelector<HTMLElement>(
    ".zotero-markdown-table-picker",
  );
  const trigger =
    anchor || root?.querySelector<HTMLElement>('[data-action="table"]');
  if (!root || !picker || !trigger) return;
  const opening = picker.hidden;
  closeToolbarMoreMenu(session);
  responsiveToolbars.get(session)?.close();
  if (!opening) {
    session.closeTablePicker?.();
    return;
  }
  tablePickerAnchors.set(session, trigger);
  picker.hidden = false;
  const bounds = root.getBoundingClientRect();
  const anchorRect = trigger.getBoundingClientRect();
  picker.style.maxWidth = `${Math.max(32, bounds.width - 16)}px`;
  picker.style.maxHeight = `${Math.max(32, bounds.bottom - anchorRect.bottom - 16)}px`;
  const rect = picker.getBoundingClientRect();
  picker.style.left = `${Math.max(bounds.left + 8, Math.min(anchorRect.left, bounds.right - rect.width - 8))}px`;
  picker.style.top = `${anchorRect.bottom + 8}px`;
  trigger.setAttribute("aria-expanded", "true");
  picker.querySelector<HTMLButtonElement>("button")?.focus();
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
  const result = await renameMarkdownAttachment(item, filename);
  if (result === false) throw new Error(getString("error-rename-missing"));
  if (result === -1) throw new Error(getString("error-rename-exists"));
  if (result === -2) throw new Error(getString("error-rename-failed"));
  invalidateNoteLibrary(item.libraryID);
  const newPath = (await item.getFilePathAsync()) || session.path;
  for (const openSession of sessionRegistry.all()) {
    if (openSession.itemID === session.itemID) openSession.path = newPath;
  }
  for (const openSession of sessionRegistry.all()) {
    if (openSession.itemID === session.itemID) openSession.updateTitle();
  }
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
    // Check the on-disk revision before deleting anything. A remote edit may
    // reference images that are absent from this editor's older buffer.
    await session.save.request({ force: true, cleanupImages: true });
    setStatus(session, "saved", getString("status-image-cleanup-complete"));
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
  rememberDocument(session.itemID, { mode });
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
  session.unbindPreviewOutline?.();
  session.unbindPreviewOutline = undefined;
  const generation = (session.previewRenderGeneration ?? 0) + 1;
  session.previewRenderGeneration = generation;
  session.mode = "preview";
  rememberDocument(session.itemID, { mode: "preview" });
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
    bindPreviewOutlineTracking(session);
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

/** Save only the requested notes, refusing competing drafts or active IME. */
export async function flushMarkdownItems(itemIDs: readonly number[]) {
  const { findSidebarSessions } = await import("./sidebar");
  for (const itemID of new Set(itemIDs)) {
    const peers = [
      ...sessionRegistry
        .all()
        .filter((peer) => peer.itemID === itemID && peer.editor),
      ...findSidebarSessions(itemID),
    ];
    const composing = () => peers.some((peer) => peer.editor?.isComposing());
    if (composing()) throw new Error(getString("note-export-composing"));
    // Snapshot table cell edits before testing dirty state. A clean stale
    // surface must never overwrite a draft in another tab/window/sidebar.
    for (const peer of peers) await peer.editor?.requestSnapshot();
    if (composing()) throw new Error(getString("note-export-composing"));
    const dirty = peers.filter((peer) => peer.save.dirty || peer.save.writing);
    if (dirty.length > 1) throw new Error(getString("note-export-conflict"));
    if (dirty[0]) await dirty[0].save.request();
    if (composing() || peers.some((peer) => peer.save.dirty))
      throw new Error(getString("note-export-conflict"));
  }
}

async function exportSessionNotes(
  session: OpenSession,
  format: "wiki" | "markdown",
) {
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error(getString("error-attachment-gone"));
    await flushMarkdownItems(
      (await Zotero.Items.getAll(item.libraryID)).map((note) => note.id),
    );
    const result = await exportNoteLibrary(session.win, item.libraryID, format);
    if (result)
      setStatus(
        session,
        "info",
        getString("note-export-complete", {
          args: {
            count: result.notes,
            warnings: result.warnings.length,
            directory: result.directory,
          },
        }),
      );
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
    session.autosaveTimer = undefined;
  }
  if (session.editor?.isComposing()) return;
  session.autosaveTimer = session.win.setTimeout(() => {
    session.autosaveTimer = undefined;
    if (session.titleSyncPending) flushTitleSync(session);
    else void requestSave(session);
  }, AUTOSAVE_MS) as unknown as number;
}

function scheduleTitleSync(session: OpenSession) {
  pauseDocumentTimers(session);
  session.titleSyncPending = true;
  if (session.editor?.isComposing()) return;
  session.titleSyncTimer = session.win.setTimeout(() => {
    session.titleSyncTimer = undefined;
    applyTitleSync(session);
  }, TITLE_SYNC_MS) as unknown as number;
}

function pauseDocumentTimers(session: OpenSession) {
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
    session.autosaveTimer = undefined;
  }
  if (session.titleSyncTimer) {
    session.win.clearTimeout(session.titleSyncTimer);
    session.titleSyncTimer = undefined;
    session.titleSyncPending = true;
  }
}

function flushTitleSync(
  session: OpenSession,
  options: { save?: boolean } = {},
) {
  if (session.titleSyncTimer) {
    session.win.clearTimeout(session.titleSyncTimer);
    session.titleSyncTimer = undefined;
  }
  applyTitleSync(session, options);
}

function applyTitleSync(
  session: OpenSession,
  options: { save?: boolean } = {},
) {
  if (session.editor?.isComposing()) {
    session.titleSyncPending = true;
    return;
  }
  session.titleSyncPending = false;
  const value = session.editor?.getValue();
  if (value === undefined) return;
  const headingTitle = extractFirstHeadingTitle(value);
  const change = headingTitle
    ? frontmatterTitleChange(value, headingTitle)
    : null;
  if (!change) {
    const force = !!session.pendingExplicitSave;
    session.pendingExplicitSave = false;
    if (options.save !== false) void requestSave(session, { force });
    return;
  }
  session.applyingTitleSync = true;
  if (options.save === false) titleSaveOwners.set(session, {});
  session.editor?.replaceRange(change.from, change.to, change.insert);
}

/** Queue the title edit before the snapshot on the same iframe channel. */
function prepareSessionSave(session: OpenSession) {
  // Forced save/close/sync may snapshot the current draft, but must never
  // dispatch a title replacement into an active native composition.
  if (session.editor?.isComposing()) return;
  if (session.titleSyncPending) flushTitleSync(session, { save: false });
  if (session.applyingTitleSync && !titleSaveOwners.has(session))
    titleSaveOwners.set(session, {});
}

function releaseTitleSaveOwner(
  session: OpenSession,
  owner: object | undefined,
) {
  if (titleSaveOwners.get(session) === owner) titleSaveOwners.delete(session);
}

function createSessionSave(session: OpenSession) {
  return new SaveCoordinator({
    canAutosave: () => !session.editor?.isComposing(),
    getSnapshot: async () => {
      prepareSessionSave(session);
      const value =
        (await session.editor?.requestSnapshot()) ??
        session.editor?.getValue() ??
        "";
      // Include the title-change echo received while awaiting this snapshot.
      return { rev: session.save.currentRev, value };
    },
    write: async (value, request) => {
      const owner = titleSaveOwners.get(session);
      try {
        await persistSession(session, value, request);
      } finally {
        // A timed-out snapshot may finish before the title echo arrives.
        releaseTitleSaveOwner(session, owner);
      }
    },
    onStateChange: () => updateSaveStatus(session),
  });
}

function requestSave(
  session: OpenSession,
  opts: { force?: boolean; cleanupImages?: boolean } = {},
) {
  const force = !!opts.force || !!session.pendingExplicitSave;
  if (!force && session.editor?.isComposing()) return Promise.resolve();
  session.pendingExplicitSave = false;
  prepareSessionSave(session);
  const owner = titleSaveOwners.get(session);
  return session.save
    .request({ ...opts, force })
    .catch((error) => {
      ztoolkit.log("Failed to save markdown", error);
      setStatus(session, "error", getString("status-save-failed"));
      new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
          type: "fail",
        })
        .show();
    })
    .finally(() => releaseTitleSaveOwner(session, owner));
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
    revision: session.fileRevision,
    syncFile: true,
    syncTitle: true,
  });
  if (session.documentSyncSourceID) {
    documentSyncRegistry.markSaved(session.documentSyncSourceID);
  }
  session.path = path;
  if (titleChanged) {
    for (const openSession of sessionRegistry.all()) {
      if (openSession.itemID === session.itemID) openSession.updateTitle();
    }
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
  cancelMetaUpdate(session);
  if (!session.view?.metaEl) return;
  const stats = session.editor?.getStats() || {
    chars: 0,
    lines: 0,
    words: 0,
  };
  session.view.metaEl.textContent = formatStats(stats);
}

function cancelMetaUpdate(session: OpenSession) {
  const timer = metaUpdateTimers.get(session);
  if (timer !== undefined) session.win.clearTimeout(timer);
  metaUpdateTimers.delete(session);
}

function scheduleMetaUpdate(session: OpenSession) {
  cancelMetaUpdate(session);
  if (session.editor?.isComposing()) return;
  const timer = session.win.setTimeout(() => {
    metaUpdateTimers.delete(session);
    if (
      sessionRegistry.get(session.tabID) === session &&
      !session.closing &&
      !session.editor?.isComposing()
    )
      updateMeta(session);
  }, 120) as unknown as number;
  metaUpdateTimers.set(session, timer);
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

export async function closeMarkdownSession(
  tabID: string,
  opts: { flush?: boolean; throwOnSaveError?: boolean } = {},
) {
  const session = sessionRegistry.get(tabID);
  if (!session) return;
  if (session.closing) {
    await session.closePromise;
    return;
  }

  session.closing = true;
  session.closePromise = (async () => {
    if (opts.flush) {
      // The same iframe channel applies this replace before the final snapshot.
      prepareSessionSave(session);
      // Asset cleanup is explicit: another open view or an undo step can
      // still reference images not present in this view's current buffer.
      if (opts.throwOnSaveError) {
        await session.save.request({ force: true });
      } else {
        await requestSave(session, { force: true });
      }
    }

    // Keep the complete editor surface alive until the final save succeeds.
    // A standalone window remains usable when a close save is rejected.
    session.closeMoreMenu?.();
    session.modal?.destroy();
    session.unbindTablePicker?.();
    responsiveToolbars.get(session)?.destroy();
    responsiveToolbars.delete(session);
    if (session.autosaveTimer) {
      session.win.clearTimeout(session.autosaveTimer);
    }
    if (session.titleSyncTimer) {
      session.win.clearTimeout(session.titleSyncTimer);
      session.titleSyncTimer = undefined;
    }
    if (session.imageRefreshTimer) {
      session.win.clearTimeout(session.imageRefreshTimer);
      session.imageRefreshTimer = undefined;
    }
    cancelMetaUpdate(session);

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
    session.unbindBacklinks?.();
    session.unbindPreviewOutline?.();
    session.editor?.destroy();
    sessionRegistry.unregister(tabID);
    if (!sessionRegistry.all().some((other) => other.itemID === session.itemID))
      forgetOpenDocument(session.itemID);
  })();
  try {
    await session.closePromise;
  } catch (error) {
    session.closing = false;
    session.closePromise = undefined;
    throw error;
  }
}

/** Close (and flush) an open Markdown tab by its tabID. */
export async function closeMarkdownTab(tabID: string): Promise<boolean> {
  const session = sessionRegistry.get(tabID);
  if (!session) return false;
  if (session.surface !== "tab") return false;
  await closeMarkdownSession(tabID, { flush: true });
  return true;
}

export async function flushSessionsForWindow(win: Window) {
  await Promise.all(
    sessionRegistry
      .sessionsForWindow(win)
      .map((session) => closeMarkdownSession(session.tabID, { flush: true })),
  );
}

export async function flushAllSessions() {
  await Promise.all(
    sessionRegistry
      .all()
      .map((session) => closeMarkdownSession(session.tabID, { flush: true })),
  );
}
