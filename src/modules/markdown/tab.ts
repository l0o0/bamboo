import {
  createMarkdownEditor,
  MarkdownEditorHandle,
  resolveEditorTheme,
} from "./editor";
import {
  iconBold,
  iconH1,
  iconH2,
  iconItalic,
  iconLink,
  iconLive,
  iconOnlyButtonHtml,
  iconPreview,
  iconSave,
  iconSource,
  modeButtonHtml,
} from "./icons";
import { mountPreviewHtml } from "./preview";
import { MARKDOWN_TAB_TYPE, resolveMarkdownTabTitle } from "./tabHooks";
import { ensureDOMGlobals, getDOMDocument } from "../../utils/dom";
import type { EditorTheme } from "./editor-protocol";

const AUTOSAVE_MS = 800;

interface OpenSession {
  tabID: string;
  itemID: number;
  path: string;
  editor?: MarkdownEditorHandle;
  dirty: boolean;
  saving: boolean;
  mode: "live" | "source" | "preview";
  rootEl?: HTMLElement;
  statusEl?: HTMLElement;
  metaEl?: HTMLElement;
  previewEl?: HTMLElement;
  editorHost?: HTMLElement;
  autosaveTimer?: number;
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
function bindSessionTheme(
  win: _ZoteroTypes.MainWindow,
  session: OpenSession,
) {
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
            classList: ["zotero-markdown-toolbar-left"],
            children: [
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-brand"],
                children: [
                  {
                    tag: "span",
                    namespace: "html",
                    classList: ["zotero-markdown-brand-badge"],
                    properties: { innerText: "MD" },
                  },
                  {
                    tag: "span",
                    namespace: "html",
                    properties: { innerText: "Markdown" },
                  },
                ],
              },
              {
                tag: "div",
                namespace: "html",
                classList: ["zotero-markdown-seg"],
                children: [
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn", "active"],
                    properties: {
                      type: "button",
                      innerHTML: modeButtonHtml(iconLive(), "Live"),
                    },
                    attributes: {
                      "data-action": "live",
                      title: "Live preview (document view)",
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: modeButtonHtml(iconSource(), "Source"),
                    },
                    attributes: {
                      "data-action": "source",
                      title: "Full Markdown source",
                    },
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    classList: ["zotero-markdown-btn"],
                    properties: {
                      type: "button",
                      innerHTML: modeButtonHtml(iconPreview(), "Preview"),
                    },
                    attributes: {
                      "data-action": "preview",
                      title: "Read-only rendered preview",
                    },
                  },
                ],
              },
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
                      innerHTML: iconOnlyButtonHtml(iconLink()),
                    },
                    attributes: {
                      "data-action": "link",
                      title: "Link (Ctrl/Cmd+K)",
                      "aria-label": "Link",
                    },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            namespace: "html",
            classList: ["zotero-markdown-toolbar-right"],
            children: [
              {
                tag: "span",
                namespace: "html",
                classList: ["zotero-markdown-status"],
                properties: { innerText: "Ready" },
              },
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
                  innerHTML: modeButtonHtml(iconSave(), "Save"),
                },
                attributes: {
                  "data-action": "save",
                  title: "Save (Ctrl/Cmd+S)",
                },
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
            classList: [
              "zotero-markdown-chip",
              session.storageLabel === "stored"
                ? "is-stored"
                : session.storageLabel === "linked"
                  ? "is-linked"
                  : "",
            ].filter(Boolean),
            properties: { innerText: session.storageLabel },
          },
          {
            tag: "span",
            namespace: "html",
            classList: ["zotero-markdown-meta"],
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
    const btn = t?.closest?.("[data-action]") as HTMLElement | null;
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute("data-action");
    if (action === "live") setMode(session, "live");
    else if (action === "source") setMode(session, "source");
    else if (action === "preview") setMode(session, "preview");
    else if (action === "save") void saveSession(session, { explicit: true });
    else if (action === "bold") session.editor?.wrapSelection("**");
    else if (action === "italic") session.editor?.wrapSelection("*");
    else if (action === "h1") session.editor?.prefixLine("# ");
    else if (action === "h2") session.editor?.prefixLine("## ");
    else if (action === "link") session.editor?.wrapSelection("[", "](url)");
  });

  const editorHost = root.querySelector(
    ".zotero-markdown-editor-host",
  ) as HTMLElement;
  const previewEl = root.querySelector(
    ".zotero-markdown-preview-host",
  ) as HTMLElement;
  const statusEl = root.querySelector(".zotero-markdown-status") as HTMLElement;
  const metaEl = root.querySelector(".zotero-markdown-meta") as HTMLElement;
  const btnLive = root.querySelector(
    '[data-action="live"]',
  ) as HTMLButtonElement;
  const btnSource = root.querySelector(
    '[data-action="source"]',
  ) as HTMLButtonElement;
  const btnPreview = root.querySelector(
    '[data-action="preview"]',
  ) as HTMLButtonElement;

  session.rootEl = root;
  session.editorHost = editorHost;
  session.previewEl = previewEl;
  session.statusEl = statusEl;
  session.metaEl = metaEl;
  (session as any)._btnLive = btnLive;
  (session as any)._btnSource = btnSource;
  (session as any)._btnPreview = btnPreview;

  applyModeVisibility(session, "live");

  const readOnly = !item.isEditable();
  session.editor = createMarkdownEditor(editorHost, {
    doc: content ?? "",
    readOnly,
    win,
    onChange: () => {
      session.dirty = true;
      setStatus(session, "Unsaved…");
      updateMeta(session);
      scheduleAutosave(session);
    },
    onSave: () => {
      void saveSession(session, { explicit: true });
    },
  });
  // Default iframe mode is live (init.mode)
  session.editor.setMode("live");

  bindSessionTheme(win, session);
  updateMeta(session);

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

function setMode(
  session: OpenSession,
  mode: "live" | "source" | "preview",
) {
  session.mode = mode;
  const btnLive = (session as any)._btnLive as HTMLButtonElement | undefined;
  const btnSource = (session as any)._btnSource as
    | HTMLButtonElement
    | undefined;
  const btnPreview = (session as any)._btnPreview as
    | HTMLButtonElement
    | undefined;

  applyModeVisibility(session, mode);

  btnLive?.classList.toggle("active", mode === "live");
  btnSource?.classList.toggle("active", mode === "source");
  btnPreview?.classList.toggle("active", mode === "preview");

  if (mode === "live" || mode === "source") {
    session.editor?.setMode(mode);
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

function scheduleAutosave(session: OpenSession) {
  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
  }
  session.autosaveTimer = session.win.setTimeout(() => {
    void saveSession(session, { explicit: false });
  }, AUTOSAVE_MS) as unknown as number;
}

async function saveSession(
  session: OpenSession,
  opts: { explicit?: boolean } = {},
) {
  if (session.saving) return;
  if (!session.dirty && !opts.explicit) return;

  const value = session.editor?.getValue();
  if (value === undefined) return;

  session.saving = true;
  setStatus(session, "Saving…");
  try {
    const item = Zotero.Items.get(session.itemID);
    if (!item) throw new Error("Item gone");
    const path = (await item.getFilePathAsync()) || session.path;
    session.path = path;
    await Zotero.File.putContentsAsync(path, value);
    session.dirty = false;
    setStatus(session, opts.explicit ? "Saved" : "Auto-saved");
    updateMeta(session);
  } catch (e) {
    ztoolkit.log("Failed to save markdown", e);
    setStatus(session, "Save failed");
    updateMeta(session);
    // Always surface save failures (including autosave)
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: `Save failed: ${e instanceof Error ? e.message : String(e)}`,
        type: "fail",
      })
      .show();
  } finally {
    session.saving = false;
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
  const shortPath = shortenPath(session.path, 52);
  session.metaEl.textContent = [
    `${stats.chars} chars`,
    `${stats.words} words`,
    `${stats.lines} lines`,
    shortPath,
  ].join("  ·  ");
  session.metaEl.title = session.path;
}

function shortenPath(path: string, max: number): string {
  if (!path) return "";
  if (path.length <= max) return path;
  return "…" + path.slice(-(max - 1));
}

async function closeSession(tabID: string, opts: { flush?: boolean } = {}) {
  const session = sessions.get(tabID);
  if (!session) return;

  if (session.autosaveTimer) {
    session.win.clearTimeout(session.autosaveTimer);
  }

  if (opts.flush && session.dirty) {
    await saveSession(session, { explicit: true });
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
