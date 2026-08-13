import {
  createMarkdownEditor,
  MarkdownEditorHandle,
  resolveEditorTheme,
} from "./editor";
import {
  iconBold,
  iconCode,
  iconH1,
  iconH2,
  iconH3,
  iconItalic,
  iconImage,
  iconList,
  iconLink,
  iconMoreHorizontal,
  iconOnlyButtonHtml,
  iconRedo,
  iconSave,
  iconTable,
  iconTask,
  iconUndo,
} from "./icons";
import { tableInsertTemplate } from "./insert-template";
import { MORE_MENU_SECTIONS, type MoreMenuAction } from "./more-menu";
import { hydratePreviewImages, mountPreviewHtml } from "./preview";
import {
  extractFirstHeadingTitle,
  frontmatterTitleChange,
} from "./frontmatter";
import {
  cleanupUnusedImageAssets,
  importExternalImages,
  resolveImageAssets,
  writeImageAsset,
} from "./images/service";
import { formatSavedStatus, formatStats } from "./status";
import { MARKDOWN_TAB_TYPE, resolveMarkdownTabTitle } from "./tabHooks";
import { ensureDOMGlobals, getDOMDocument } from "../../utils/dom";
import type { EditorTheme } from "./editor-protocol";

const AUTOSAVE_MS = 800;
const TITLE_SYNC_MS = 1000;

interface OpenSession {
  tabID: string;
  itemID: number;
  path: string;
  editor?: MarkdownEditorHandle;
  dirty: boolean;
  saving: boolean;
  saveFailed: boolean;
  mode: "live" | "source" | "preview";
  rootEl?: HTMLElement;
  statusEl?: HTMLElement;
  metaEl?: HTMLElement;
  savedAt?: Date;
  previewEl?: HTMLElement;
  editorHost?: HTMLElement;
  autosaveTimer?: number;
  imageRefreshTimer?: number;
  pendingImageSave?: boolean;
  titleSyncTimer?: number;
  applyingTitleSync?: boolean;
  pendingExplicitSave?: boolean;
  pendingImageCleanup?: boolean;
  closeMoreMenu?: () => void;
  closeTablePicker?: () => void;
  unbindTablePicker?: () => void;
  storageLabel: string;
  win: _ZoteroTypes.MainWindow;
  /** Tear down live theme listeners when the tab closes */
  unbindTheme?: () => void;
}

const sessions = new Map<string, OpenSession>();
const itemToTab = new Map<number, string>();

export function getSessionByTabID(tabID: string) {
  return sessions.get(tabID);
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

  const existingTabID = itemToTab.get(item.id);
  if (existingTabID) {
    const existing = sessions.get(existingTabID);
    const tabInfo = win.Zotero_Tabs._getTab(existingTabID);
    if (existing && tabInfo?.tab) {
      ensureTabTitle(win, existingTabID, item.id);
      try {
        win.Zotero_Tabs.select(existingTabID);
      } catch (e) {
        ztoolkit.log("select existing markdown tab failed", e);
        ensureTabTitle(win, existingTabID, item.id);
        win.Zotero_Tabs.select(existingTabID);
      }
      existing.editor?.focus();
      return existingTabID;
    }
    itemToTab.delete(item.id);
    sessions.delete(existingTabID);
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
    content = (await Zotero.File.getContentsAsync(path)) as string;
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
    dirty: false,
    saving: false,
    saveFailed: false,
    mode: "live",
    storageLabel,
    win,
  };
  sessions.set(tabID, session);
  itemToTab.set(item.id, tabID);

  try {
    mountEditorUI(win, host, session, content, item);
  } catch (e) {
    ztoolkit.log("Failed to mount markdown editor", e);
    try {
      win.Zotero_Tabs.close(tabID);
    } catch {
      // ignore
    }
    sessions.delete(tabID);
    itemToTab.delete(item.id);
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
    applyShellTheme(session.rootEl, theme);
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

function mountEditorUI(
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
  session: OpenSession,
  content: string,
  item: Zotero.Item,
) {
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
                  "zotero-markdown-btn-primary",
                  "zotero-markdown-btn-save",
                ],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconSave()),
                },
                attributes: {
                  "data-action": "save",
                  title: "Save (Ctrl/Cmd+S)",
                  "aria-label": "Save",
                },
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-sep"],
              },
              ...[
                ["undo", iconUndo(), "Undo", "Undo (Ctrl/Cmd+Z)"],
                ["redo", iconRedo(), "Redo", "Redo (Ctrl/Cmd+Shift+Z)"],
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
                      title: "Bold (Ctrl/Cmd+B)",
                      "aria-label": "Bold",
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
                      title: "Italic (Ctrl/Cmd+I)",
                      "aria-label": "Italic",
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
                      title: "Heading 1 (Ctrl/Cmd+1)",
                      "aria-label": "Heading 1",
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
                      title: "Heading 2 (Ctrl/Cmd+2)",
                      "aria-label": "Heading 2",
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
                      title: "Heading 3",
                      "aria-label": "Heading 3",
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
                      title: "Bullet list",
                      "aria-label": "Bullet list",
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
                      title: "Link (Ctrl/Cmd+K)",
                      "aria-label": "Link",
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
                      title: "Insert image",
                      "aria-label": "Insert image",
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
                          title: "Insert table",
                          "aria-label": "Insert table",
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
                      title: "Task list",
                      "aria-label": "Task list",
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
                      title: "Inline code",
                      "aria-label": "Inline code",
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
                classList: ["zotero-markdown-btn", "zotero-markdown-more"],
                properties: {
                  type: "button",
                  innerHTML: iconOnlyButtonHtml(iconMoreHorizontal()),
                },
                attributes: {
                  "data-action": "more",
                  title: "More actions",
                  "aria-label": "More actions",
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
    if (action === "save")
      void saveSession(session, { explicit: true, cleanupImages: true });
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
    } else if (action === "more") {
      toggleMoreMenu(session);
    }
  });

  const editorHost = root.querySelector(
    ".zotero-markdown-editor-host",
  ) as HTMLElement;
  const previewEl = root.querySelector(
    ".zotero-markdown-preview-host",
  ) as HTMLElement;
  const statusEl = root.querySelector(".zotero-markdown-status") as HTMLElement;
  const metaEl = root.querySelector(".zotero-markdown-meta") as HTMLElement;
  const saveStatusEl = root.querySelector(
    ".zotero-markdown-save-status",
  ) as HTMLElement;

  session.rootEl = root;
  session.editorHost = editorHost;
  session.previewEl = previewEl;
  session.statusEl = statusEl;
  session.metaEl = metaEl;
  (session as any)._saveStatusEl = saveStatusEl;
  bindTablePicker(session);
  mountMoreMenu(session);

  applyModeVisibility(session, "live");

  const readOnly = !item.isEditable();
  session.editor = createMarkdownEditor(editorHost, {
    doc: content ?? "",
    readOnly,
    win,
    channel: `${session.tabID}:${session.itemID}`,
    onChange: (value) => {
      const appliedTitleSync = !!session.applyingTitleSync;
      session.applyingTitleSync = false;
      session.dirty = true;
      session.saveFailed = false;
      setStatus(session, "Unsaved…");
      updateMeta(session);
      updateSaveStatus(session);
      scheduleImageAssetRefresh(session);
      const headingTitle = extractFirstHeadingTitle(value);
      const titleChange = headingTitle
        ? frontmatterTitleChange(value, headingTitle)
        : null;
      if (titleChange && !appliedTitleSync) {
        scheduleTitleSync(session);
      } else if (appliedTitleSync) {
        const explicit = !!session.pendingExplicitSave;
        const cleanupImages = !!session.pendingImageCleanup;
        session.pendingExplicitSave = false;
        session.pendingImageCleanup = false;
        void saveSession(session, { explicit, cleanupImages });
      } else {
        scheduleAutosave(session);
      }
      if (session.pendingImageSave) {
        session.pendingImageSave = false;
        void saveSession(session, { explicit: false });
      }
    },
    onSave: () => {
      if (session.titleSyncTimer) {
        session.pendingExplicitSave = true;
        session.pendingImageCleanup = true;
        flushTitleSync(session);
      } else {
        void saveSession(session, { explicit: true, cleanupImages: true });
      }
    },
    onPasteImage: ({ bytes, mimeType }) => {
      void insertImageBytes(session, new Uint8Array(bytes), mimeType);
    },
  });
  // Default iframe mode is live (init.mode)
  session.editor.setMode("live");
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

function applyModeVisibility(
  session: OpenSession,
  mode: "live" | "source" | "preview",
) {
  const root = session.rootEl;
  const editorHost = session.editorHost;
  const previewEl = session.previewEl;

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
  const root = session.rootEl;
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
      button.append(item.label);
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
      menu.appendChild(button);
    }
  });

  const modeMenu = menu.ownerDocument.createElement("div");
  modeMenu.className = "zotero-markdown-mode-menu";
  modeMenu.hidden = true;
  for (const mode of ["live", "source", "preview"] as const) {
    const button = menu.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "zotero-markdown-more-menu-item";
    button.dataset.mode = mode;
    button.textContent = mode[0].toUpperCase() + mode.slice(1);
    modeMenu.appendChild(button);
  }
  menu.appendChild(modeMenu);

  const close = () => {
    menu.hidden = true;
    modeMenu.hidden = true;
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
      modeMenu.hidden = !modeMenu.hidden;
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
    showUnavailableAction(action);
    close();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!menu.hidden && !menu.contains(event.target as Node)) close();
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

function toggleMoreMenu(session: OpenSession) {
  const menu = session.rootEl?.querySelector(".zotero-markdown-more-menu") as
    HTMLElement | undefined;
  if (!menu) return;
  session.closeTablePicker?.();
  menu.hidden = !menu.hidden;
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
  const root = session.rootEl;
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
  const picker = session.rootEl?.querySelector<HTMLElement>(
    ".zotero-markdown-table-picker",
  );
  const trigger = session.rootEl?.querySelector<HTMLElement>(
    '[data-action="table"]',
  );
  if (!picker || !trigger) return;
  const opening = picker.hidden;
  const moreMenu = session.rootEl?.querySelector<HTMLElement>(
    ".zotero-markdown-more-menu",
  );
  if (moreMenu) moreMenu.hidden = true;
  picker.hidden = !opening;
  trigger.setAttribute("aria-expanded", String(opening));
}

function showUnavailableAction(action: MoreMenuAction) {
  const labels: Partial<Record<MoreMenuAction, string>> = {
    "document-info": "文档信息",
    rename: "重命名",
    "show-in-folder": "在文件夹中显示",
    "export-pdf": "导出为 PDF",
    "export-html": "导出为 HTML",
    shortcuts: "快捷键",
    settings: "设置",
  };
  const label = labels[action] || "此功能";
  new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({ text: `${label}功能规划中`, type: "default" })
    .show();
}

async function importExternalImagesInSession(session: OpenSession) {
  try {
    const item = Zotero.Items.get(session.itemID);
    const source = session.editor?.getValue() || "";
    if (!item) throw new Error("Markdown 附件已不存在");
    const result = await importExternalImages(item, source);
    if (!result.imported) {
      showImageError(new Error("没有可导入的外链图片，或下载失败"));
      return;
    }
    session.editor?.setValue(result.markdown);
    session.dirty = true;
    session.pendingImageSave = false;
    scheduleAutosave(session);
    await saveSession(session, { explicit: false });
    setStatus(session, `已导入 ${result.imported} 张外链图片`);
  } catch (error) {
    showImageError(error);
  }
}

async function cleanupImagesInSession(session: OpenSession) {
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error("Markdown 附件已不存在");
    const removed = await cleanupUnusedImageAssets(
      item,
      session.editor?.getValue() || "",
    );
    if (removed) {
      // Zotero detects stored text attachment changes from the main file.
      // Re-save it so asset deletions are included in the next zip upload.
      await saveSession(session, { explicit: true });
    }
    setStatus(
      session,
      removed ? `已清理 ${removed} 张未引用图片` : "没有未引用图片",
    );
  } catch (error) {
    showImageError(error);
  }
}

function setMode(session: OpenSession, mode: "live" | "source" | "preview") {
  session.mode = mode;
  const btnLive = (session as any)._btnLive as HTMLButtonElement | undefined;
  const btnSource = (session as any)._btnSource as
    HTMLButtonElement | undefined;
  const btnPreview = (session as any)._btnPreview as
    HTMLButtonElement | undefined;

  applyModeVisibility(session, mode);

  btnLive?.classList.toggle("active", mode === "live");
  btnSource?.classList.toggle("active", mode === "source");
  btnPreview?.classList.toggle("active", mode === "preview");

  if (mode === "live" || mode === "source") {
    session.editor?.setMode(mode);
    if (mode === "live") {
      void refreshImageAssets(session);
    }
    setStatus(session, session.dirty ? "Unsaved…" : "Ready");
    updateMeta(session);
    session.win.requestAnimationFrame(() => {
      session.editor?.focus();
      session.editor?.view.requestMeasure();
    });
  } else {
    const source = session.editor?.getValue() ?? "";
    if (session.previewEl) {
      try {
        mountPreviewHtml(session.previewEl, source);
        void hydrateSessionPreviewImages(session, source);
        setStatus(session, "Preview");
      } catch (e) {
        ztoolkit.log("Preview render error", e);
        session.previewEl.textContent = source;
        setStatus(session, "Preview (plain)");
      }
    }
    updateMeta(session);
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
    showImageError(new Error("仅存储在 Zotero 中的 Markdown 附件支持插入图片"));
    return;
  }
  const doc = session.rootEl?.ownerDocument;
  if (!doc) return;
  const input = doc.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.hidden = true;
  session.rootEl?.appendChild(input);
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
    if (!item) throw new Error("Markdown 附件已不存在");
    const reference = await writeImageAsset(item, bytes, mimeType);
    session.pendingImageSave = true;
    session.editor?.insertText(`![](${reference})`, 2, 2);
    void refreshImageAssets(session);
  } catch (error) {
    session.pendingImageSave = false;
    showImageError(error);
  }
}

function scheduleImageAssetRefresh(session: OpenSession) {
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
      `[Zotero Markdown][ImageDebug] asset-refresh-skipped ${JSON.stringify({
        hasItem: !!item,
        hasEditor: !!session.editor,
        mode: session.mode,
      })}`,
    );
    return;
  }
  Zotero.debug(
    `[Zotero Markdown][ImageDebug] asset-refresh-start ${JSON.stringify({
      mode: session.mode,
      itemID: session.itemID,
    })}`,
  );
  try {
    const assets = await resolveImageAssets(item, session.editor.getValue());
    if (sessions.get(session.tabID) !== session) {
      Zotero.debug("[Zotero Markdown][ImageDebug] asset-refresh-stale-session");
      return;
    }
    const summary = Object.fromEntries(
      Object.entries(assets).map(([reference, asset]) => [
        reference,
        asset.error ? `error: ${asset.error}` : "ready",
      ]),
    );
    Zotero.debug(
      `[Zotero Markdown][ImageDebug] asset-refresh-complete ${JSON.stringify({
        mode: session.mode,
        assets: summary,
      })}`,
    );
    session.editor.setImageAssets(assets);
    if (session.mode === "preview" && session.previewEl) {
      hydratePreviewImages(session.previewEl, assets);
    }
  } catch (error) {
    Zotero.debug(
      `[Zotero Markdown][ImageDebug] asset-refresh-error ${String(error)}`,
    );
    throw error;
  }
}

async function hydrateSessionPreviewImages(
  session: OpenSession,
  source: string,
) {
  const item = Zotero.Items.get(session.itemID);
  if (!item || !session.previewEl) return;
  const assets = await resolveImageAssets(item, source);
  if (session.mode !== "preview" || !session.previewEl) return;
  hydratePreviewImages(session.previewEl, assets);
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
      session.editor?.setValue(
        value.slice(0, change.from) + change.insert + value.slice(change.to),
      );
    }
  }
  session.autosaveTimer = session.win.setTimeout(() => {
    void saveSession(session, { explicit: false });
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
    const explicit = !!session.pendingExplicitSave;
    const cleanupImages = !!session.pendingImageCleanup;
    session.pendingExplicitSave = false;
    session.pendingImageCleanup = false;
    void saveSession(session, { explicit, cleanupImages });
    return;
  }
  session.applyingTitleSync = true;
  session.editor?.replaceRange(change.from, change.to, change.insert);
}

async function saveSession(
  session: OpenSession,
  opts: { explicit?: boolean; cleanupImages?: boolean } = {},
) {
  if (session.saving) return;
  if (!session.dirty && !opts.explicit) return;

  const value = session.editor?.getValue();
  if (value === undefined) return;

  session.saving = true;
  session.saveFailed = false;
  setStatus(session, "Saving…");
  updateSaveStatus(session);
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error("Item gone");
    const path = (await item.getFilePathAsync()) || session.path;
    session.path = path;
    await Zotero.File.putContentsAsync(path, value);
    if (opts.cleanupImages) {
      try {
        await cleanupUnusedImageAssets(item, value);
      } catch (error) {
        ztoolkit.log("Failed to clean markdown image assets after save", error);
      }
    }
    const headingTitle = extractFirstHeadingTitle(value);
    if (headingTitle && item.getField("title") !== headingTitle) {
      item.setField("title", headingTitle);
      await item.saveTx({ skipSelect: true });
      ensureTabTitle(session.win, session.tabID, session.itemID);
    }
    session.dirty = false;
    session.saveFailed = false;
    session.savedAt = new Date();
    setStatus(session, opts.explicit ? "Saved" : "Auto-saved");
    updateMeta(session);
    updateSaveStatus(session);
  } catch (e) {
    ztoolkit.log("Failed to save markdown", e);
    session.saveFailed = true;
    setStatus(session, "Save failed");
    updateMeta(session);
    updateSaveStatus(session);
    // Always surface save failures (including autosave)
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Save failed: ${e instanceof Error ? e.message : String(e)}`,
        type: "fail",
      })
      .show();
  } finally {
    session.saving = false;
    updateSaveStatus(session);
  }
}

function setStatus(session: OpenSession, text: string) {
  if (!session.statusEl) return;
  session.statusEl.textContent = text;
  session.statusEl.classList.remove("is-dirty", "is-saved", "is-error");
  const t = text.toLowerCase();
  if (t.includes("fail") || t.includes("error")) {
    session.statusEl.classList.add("is-error");
  } else if (t.includes("unsaved") || t.includes("saving")) {
    session.statusEl.classList.add("is-dirty");
  } else if (
    t.includes("saved") ||
    t.includes("ready") ||
    t.includes("preview")
  ) {
    session.statusEl.classList.add("is-saved");
  }
}

function updateMeta(session: OpenSession) {
  if (!session.metaEl) return;
  const stats = session.editor?.getStats() || {
    chars: 0,
    lines: 0,
    words: 0,
  };
  session.metaEl.textContent = formatStats(stats);
}

function updateSaveStatus(session: OpenSession) {
  const statusEl = (session as any)._saveStatusEl as HTMLElement | undefined;
  if (!statusEl) return;

  statusEl.classList.remove("is-dirty", "is-saved", "is-error");
  if (session.saving) {
    statusEl.textContent = "正在保存…";
    statusEl.classList.add("is-dirty");
  } else if (session.saveFailed) {
    statusEl.textContent = "保存失败";
    statusEl.classList.add("is-error");
  } else if (session.dirty) {
    statusEl.textContent = "有未保存的更改";
    statusEl.classList.add("is-dirty");
  } else if (session.savedAt) {
    statusEl.textContent = formatSavedStatus(session.savedAt);
    statusEl.classList.add("is-saved");
  } else {
    statusEl.textContent = "自动保存已开启";
    statusEl.classList.add("is-saved");
  }
}

async function closeSession(tabID: string, opts: { flush?: boolean } = {}) {
  const session = sessions.get(tabID);
  if (!session) return;

  session.closeMoreMenu?.();
  session.unbindTablePicker?.();
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
  }

  if (opts.flush) {
    // Rewriting the main attachment lets Zotero include sidecar deletions in
    // the next stored-file sync, even when autosave already cleared `dirty`.
    await saveSession(session, { explicit: true, cleanupImages: true });
  }

  try {
    session.unbindTheme?.();
  } catch {
    // ignore
  }
  session.editor?.destroy();
  itemToTab.delete(session.itemID);
  sessions.delete(tabID);
}

export async function flushAllSessions() {
  await Promise.all(
    [...sessions.keys()].map((id) => closeSession(id, { flush: true })),
  );
}
