/**
 * Sidebar (item pane) Markdown editor — a "Markdown" section in Zotero's
 * right sidebar, styled after the built-in Notes section.
 *
 * Uses the official `Zotero.ItemPaneManager.registerSection()` plugin API
 * (Zotero 8/9). Each main window gets its own `SidebarController`; the
 * section shows the selected item's `.md` attachments (list) plus an inline
 * editor, reusing the same chrome:// CodeMirror iframe, `SaveCoordinator`
 * and `persistMarkdownContent` write path as the main-window tabs.
 */
import { getLocaleID, getString } from "../../utils/locale";
import { createMarkdownEditor, type MarkdownEditorHandle } from "./editor";
import { SaveCoordinator } from "./save-coordinator";
import { persistMarkdownContent } from "./persist";
import { isMarkdownAttachment } from "./detect";
import { createMarkdownAttachment } from "./create";
import { openMarkdownTab } from "./tab";
import { sessionRegistry } from "./session-registry";
import { stripFrontmatter } from "./frontmatter";
import {
  resolveImageAssetEntry,
  resolveImageAssets,
  writeImageAsset,
} from "./images/service";
import type { ImageAssetMap } from "./editor-protocol";
import {
  iconBold,
  iconH1,
  iconItalic,
  iconLink,
  iconList,
  iconMoreHorizontal,
  iconOnlyButtonHtml,
  iconOpenInNew,
} from "./icons";
import {
  canReuseSidebarEditor,
  planSidebarVisibility,
  sidebarFocusAction,
  SidebarControllerRegistry,
  shouldMountSidebarUI,
  shouldUseSidebarFocusMode,
  type SidebarBodyState,
} from "./sidebar-state";

const AUTOSAVE_DELAY_MS = 1500;
const PENDING_RENDER_INTERVAL_MS = 100;
const PENDING_RENDER_MAX_RETRIES = 50;

const controllers = new SidebarControllerRegistry<
  _ZoteroTypes.MainWindow,
  HTMLElement,
  SidebarController
>();

/**
 * Sidebar editor sessions currently editing `itemID` (across windows).
 * Lets the public API treat sidebar edits like tab sessions: reads prefer the
 * live buffer and writes conflict on unsaved changes instead of silently
 * clobbering each other (see `api.ts` `currentContent` / `writeContent`).
 */
export function findSidebarSessions(
  itemID: number,
): Array<{ editor: MarkdownEditorHandle; save: SaveCoordinator }> {
  const out: Array<{ editor: MarkdownEditorHandle; save: SaveCoordinator }> =
    [];
  for (const controller of controllers.all()) {
    if (controller.currentItemID !== itemID) continue;
    const session = controller.getSession();
    if (session) out.push(session);
  }
  return out;
}

/** Save and close every sidebar editor for an attachment before removal. */
export async function closeSidebarSessions(itemID: number): Promise<number> {
  const matching = controllers
    .all()
    .filter((controller) => controller.currentItemID === itemID);
  const closed = await Promise.all(
    matching.map((controller) => controller.closeItemSession(itemID)),
  );
  return closed.filter(Boolean).length;
}

function faviconURL(): string {
  return `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;
}

let sectionKey: string | null = null;

type ZoteroItemPaneElement = Element & { collapsed: boolean };
type ZoteroCollapsibleSectionElement = Element & {
  open: boolean;
  collapsible: boolean;
};

/** Register the "Markdown" item-pane section (idempotent, global). */
export function registerSidebarSection(): void {
  try {
    if (!Zotero.ItemPaneManager?.registerSection) {
      ztoolkit.log("ItemPaneManager unavailable; sidebar section skipped");
      return;
    }
    const key = Zotero.ItemPaneManager.registerSection({
      paneID: "zmd-markdown",
      pluginID: addon.data.config.addonID,
      sidenav: {
        icon: faviconURL(),
        l10nID: getLocaleID("sidebar-section-tooltip"),
      },
      header: {
        icon: faviconURL(),
        l10nID: getLocaleID("sidebar-section-label"),
      },
      onInit: ({ doc, body, setSectionSummary }) => {
        // UI is not rendered yet — only create the controller skeleton.
        // Content is populated only by onRender, as required by Zotero's
        // ItemPaneManager lifecycle contract.
        const win = doc.defaultView as _ZoteroTypes.MainWindow | null;
        if (!win) return;
        // A window can host multiple item-pane/context-pane section bodies.
        // Replace only a stale controller bound to this exact body.
        controllers.release(win, body)?.destroy();
        const controller = new SidebarController(win);
        controllers.bind(win, body, controller);
        controller.bindSummary(setSectionSummary);
      },
      onDestroy: ({ doc, body }) => {
        const win = doc.defaultView as _ZoteroTypes.MainWindow | null;
        if (!win) return;
        controllers.release(win, body)?.destroy();
      },
      onRender: ({ doc, body, item, editable, setSectionSummary }) => {
        // Required by ItemPaneManager; this is where the section renders.
        // Keep it synchronous — async work is deferred inside setItem.
        const win = doc.defaultView as _ZoteroTypes.MainWindow | null;
        if (!win) return;
        if (shouldMountSidebarUI("render")) {
          controllers
            .get(body)
            ?.render(body, item, editable, setSectionSummary, "render");
        }
      },
    });
    if (key === false) {
      ztoolkit.log("Failed to register Markdown sidebar section");
      return;
    }
    sectionKey = key;
  } catch (error) {
    ztoolkit.log("registerSidebarSection failed", error);
  }
}

export async function unregisterSidebarSection(): Promise<void> {
  if (sectionKey) {
    try {
      Zotero.ItemPaneManager?.unregisterSection(sectionKey);
    } catch (error) {
      ztoolkit.log("unregisterSidebarSection failed", error);
    }
    sectionKey = null;
  }
  await Promise.all(
    Zotero.getMainWindows().flatMap((win) =>
      controllers.releaseWindow(win).map((controller) => controller.destroy()),
    ),
  );
}

/** Destroy the sidebar editor for a closing window (awaits the final flush). */
export async function disposeSidebarForWindow(win: Window): Promise<void> {
  await Promise.all(
    controllers
      .releaseWindow(win as _ZoteroTypes.MainWindow)
      .map((controller) => controller.destroy()),
  );
}

async function readFileText(path: string): Promise<string> {
  const data = await Zotero.File.getContentsAsync(path);
  return typeof data === "string" ? data : String(data ?? "");
}

function collectMarkdownAttachmentIDs(item: Zotero.Item): number[] {
  return item.getAttachments().filter((id) => {
    const attachment = Zotero.Items.get(id);
    return isMarkdownAttachment(attachment);
  });
}

/** First non-empty line of the body (frontmatter stripped). */
function listSnippet(content: string): string {
  const { body } = stripFrontmatter(content);
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^#{1,6}\s+/, "").trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return "";
}

class SidebarController {
  private readonly win: _ZoteroTypes.MainWindow;
  private readonly root: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly editorHost: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly emptyText: HTMLElement;
  private readonly hintEl: HTMLElement;

  /** Item currently edited by this controller (null when idle). */
  get currentItemID(): number | null {
    return this.itemID;
  }

  /** Live editor + save coordinator when this controller is editing. */
  getSession(): { editor: MarkdownEditorHandle; save: SaveCoordinator } | null {
    return this.editor && this.save
      ? { editor: this.editor, save: this.save }
      : null;
  }

  async closeItemSession(itemID: number): Promise<boolean> {
    if (this.itemID !== itemID) return false;
    this.renderSeq++;
    if (this.autosaveTimer != null) {
      this.win.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    await this.save?.request({ force: true });
    if (this.itemID === itemID) this.destroyEditor();
    return true;
  }

  private editor: MarkdownEditorHandle | null = null;
  private save: SaveCoordinator | null = null;
  private item: Zotero.Item | null = null;
  private itemID: number | null = null;
  private editable = true;
  private autosaveTimer: number | null = null;
  private setSummary: ((summary: string) => void) | null = null;
  private lastSummary: ((summary: string) => void) | null = null;
  private pendingBody: HTMLElement | null = null;
  private pendingItem: Zotero.Item | null = null;
  private pendingEditable = true;
  private pendingTimer: number | null = null;
  private pendingRetries = 0;
  private destroyed = false;
  private attachmentIDs: number[] = [];
  private focusContainer: HTMLElement | null = null;
  private focusShell: HTMLElement | null = null;
  private focusSection: Element | null = null;
  private focusCollapsible: ZoteroCollapsibleSectionElement | null = null;
  private focusSidenav: Element | null = null;
  private focusPaneID: string | null = null;
  private focusItemID: number | null = null;
  private focusSuppressed = false;
  private focusWasOpen = true;
  private focusWasCollapsible = true;
  /** Monotonic render sequence; invalidates in-flight async renders. */
  private renderSeq = 0;

  constructor(win: _ZoteroTypes.MainWindow) {
    this.win = win;
    const doc = win.document;

    this.root = doc.createElement("div");
    this.root.className = "zmd-sidebar";

    this.toolbar = doc.createElement("div");
    this.toolbar.className = "zmd-sidebar-toolbar";
    this.toolbar.hidden = true;
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Markdown formatting");

    const toolbarButton = (
      action: string,
      label: string,
      icon: string,
      editorAction = false,
    ) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zmd-sidebar-toolbar-button";
      button.dataset.action = action;
      if (editorAction) button.dataset.editorAction = "true";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = iconOnlyButtonHtml(icon);
      return button;
    };

    const openTabButton = toolbarButton(
      "open-tab",
      getString("sidebar-open-tab"),
      iconOpenInNew(),
    );
    const separator = doc.createElement("span");
    separator.className = "zmd-sidebar-toolbar-separator";
    const formatButtons = [
      toolbarButton("bold", getString("sidebar-bold"), iconBold(), true),
      toolbarButton("italic", getString("sidebar-italic"), iconItalic(), true),
      toolbarButton("h1", getString("sidebar-h1"), iconH1(), true),
      toolbarButton("list", getString("sidebar-list"), iconList(), true),
      toolbarButton("link", getString("sidebar-link"), iconLink(), true),
    ];
    const spacer = doc.createElement("span");
    spacer.className = "zmd-sidebar-toolbar-spacer";
    const moreButton = toolbarButton(
      "more",
      getString("sidebar-more"),
      iconMoreHorizontal(),
    );
    this.toolbar.append(
      openTabButton,
      separator,
      ...formatButtons,
      spacer,
      moreButton,
    );

    this.listEl = doc.createElement("div");
    this.listEl.className = "zmd-sidebar-list";

    this.editorHost = doc.createElement("div");
    this.editorHost.className = "zmd-sidebar-editor-host";

    this.emptyEl = doc.createElement("div");
    this.emptyEl.className = "zmd-sidebar-empty";
    this.emptyText = doc.createElement("p");
    const emptyButton = doc.createElement("button");
    emptyButton.type = "button";
    emptyButton.className = "zmd-sidebar-action";
    emptyButton.textContent = getString("sidebar-new-md");

    this.hintEl = doc.createElement("div");
    this.hintEl.className = "zmd-sidebar-hint";
    const hintText = doc.createElement("p");
    hintText.textContent = getString("sidebar-open-in-tab");
    const hintButton = doc.createElement("button");
    hintButton.type = "button";
    hintButton.className = "zmd-sidebar-action";
    hintButton.textContent = getString("sidebar-switch-to-tab");

    this.emptyEl.append(this.emptyText, emptyButton);
    this.hintEl.append(hintText, hintButton);
    this.root.append(
      this.toolbar,
      this.listEl,
      this.editorHost,
      this.emptyEl,
      this.hintEl,
    );

    this.toolbar.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest?.("[data-action]") as HTMLElement | null;
      const action = button?.dataset.action;
      if (!action || !this.toolbar.contains(button)) return;
      if (action === "open-tab") {
        void this.openInTab();
      } else if (action === "bold") {
        this.editor?.wrapSelection("**");
      } else if (action === "italic") {
        this.editor?.wrapSelection("*");
      } else if (action === "h1") {
        this.editor?.prefixLine("# ");
      } else if (action === "list") {
        this.editor?.prefixLine("- ");
      } else if (action === "link") {
        this.editor?.wrapSelection("[", "](url)");
      } else if (action === "more") {
        new ztoolkit.ProgressWindow(addon.data.config.addonName)
          .createLine({
            text: getString("sidebar-more-planned"),
            type: "default",
          })
          .show();
      }
      if (action !== "open-tab" && action !== "more") this.editor?.focus();
    });

    hintButton.addEventListener("click", () => {
      const item = this.itemID != null ? Zotero.Items.get(this.itemID) : null;
      if (item) void openMarkdownTab(item, { win: this.win });
    });
    emptyButton.addEventListener("click", () => void this.createNew());
  }

  /**
   * Render the section into the CURRENT body element provided by Zotero.
   * Follows the ItemPaneManager contract: the UI is (re)attached on every
   * render so it survives section re-initialization / body replacement.
   */
  render(
    body: HTMLElement,
    item: Zotero.Item | null,
    editable: boolean,
    setSummary?: (summary: string) => void,
    source?: string,
  ): void {
    if (this.destroyed) return;
    if (setSummary) {
      this.lastSummary = setSummary;
      this.bindSummary(setSummary);
    }

    // Zotero can fire the hooks while the section element is not yet
    // attached to the live DOM. Resolve a connected target body first:
    // 1. the body passed by the hook, if connected;
    // 2. otherwise the live section body found in the window document;
    // 3. otherwise queue the render and retry until it connects.
    let target = body;
    if (!target.isConnected) {
      const live = this.win.document.querySelector(
        'item-pane-custom-section[data-pane="zmd-markdown"] [data-type="body"]',
      );
      if (live instanceof HTMLElement && live.isConnected) {
        target = live;
      }
    }
    if (!target.isConnected) {
      ztoolkit.log("sidebar render deferred (body not connected)", {
        source: source ?? "render",
        itemID: item?.id ?? null,
      });
      this.pendingBody = body;
      this.pendingItem = item;
      this.pendingEditable = editable;
      this.schedulePendingRender();
      return;
    }
    this.cancelPendingRender();

    if (this.root.parentElement !== target) {
      if (this.root.parentElement) this.root.remove();
      target.appendChild(this.root);
    }
    this.applyFocusMode(target, item);
    ztoolkit.log("sidebar render", {
      source: source ?? "render",
      itemID: item?.id ?? null,
      attached: this.root.isConnected,
    });
    this.setItem(item, editable);
  }

  private schedulePendingRender(): void {
    if (this.pendingTimer != null) return;
    if (this.pendingRetries >= PENDING_RENDER_MAX_RETRIES) {
      ztoolkit.log(
        "sidebar render deferred too long; giving up (next hook re-triggers)",
      );
      this.pendingBody = null;
      return;
    }
    this.pendingRetries++;
    this.pendingTimer = this.win.setTimeout(() => {
      this.pendingTimer = null;
      if (this.destroyed) return;
      const body = this.pendingBody;
      this.pendingBody = null;
      if (body) this.render(body, this.pendingItem, this.pendingEditable);
    }, PENDING_RENDER_INTERVAL_MS) as unknown as number;
  }

  private cancelPendingRender(): void {
    if (this.pendingTimer != null) {
      this.win.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingRetries = 0;
  }

  setItem(item: Zotero.Item | null, editable: boolean): void {
    // Bump the render sequence so any in-flight async openEditor for a
    // previously selected item aborts (rapid item-tree navigation).
    const seq = ++this.renderSeq;
    this.editable = editable;
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>(
      "[data-editor-action]",
    )) {
      button.disabled = !editable;
    }
    this.editor?.setReadOnly?.(!editable);
    this.item = item;

    if (!item) {
      this.showEmpty(getString("sidebar-empty-no-item"));
      return;
    }
    if (isMarkdownAttachment(item)) {
      this.attachmentIDs = [];
      void this.openEditor(item, seq);
      return;
    }
    const ids = collectMarkdownAttachmentIDs(item);
    this.attachmentIDs = ids;
    if (!ids.length) {
      this.showEmpty(getString("sidebar-empty"));
      return;
    }
    this.renderList(ids, seq);
    const keep =
      this.selectedItemID && ids.includes(this.selectedItemID)
        ? this.selectedItemID
        : ids[0];
    const target = Zotero.Items.get(keep);
    if (target) void this.openEditor(target, seq);
  }

  /**
   * Tear down the controller. Returns a promise that resolves once any
   * pending editor flush has been written to disk, so window teardown can
   * `await` it instead of losing unsaved changes.
   */
  destroy(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.renderSeq++;
    this.cancelPendingRender();
    this.clearFocusMode();
    this.unbindFocusSidenav();
    this.setSummary = null;
    this.lastSummary = null;
    if (this.autosaveTimer != null) {
      this.win.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    const editor = this.editor;
    const save = this.save;
    this.save = null;
    this.root.remove();
    return (async () => {
      if (editor && save) {
        try {
          await save.request({ force: true });
        } catch (error) {
          ztoolkit.log("Sidebar flush on destroy failed", error);
        } finally {
          editor.destroy();
        }
      }
    })();
  }

  /** Bind the section header summary setter from the pane hooks. */
  bindSummary(setSummary: (summary: string) => void): void {
    this.setSummary = setSummary;
    this.lastSummary = setSummary;
    this.updateSummary();
  }

  private get selectedItemID(): number | null {
    return this.itemID;
  }

  private hasParentAttachmentList(): boolean {
    return (
      !!this.item &&
      !isMarkdownAttachment(this.item) &&
      this.attachmentIDs.length > 0
    );
  }

  private applyBodyState(state: SidebarBodyState): void {
    const visibility = planSidebarVisibility(
      state,
      this.hasParentAttachmentList(),
    );
    this.listEl.hidden = !visibility.list;
    this.editorHost.hidden = !visibility.editor;
    this.hintEl.hidden = !visibility.hint;
    this.emptyEl.hidden = !visibility.empty;
  }

  private beginLoading(): void {
    this.listEl.hidden = !this.hasParentAttachmentList();
    this.editorHost.hidden = true;
    this.hintEl.hidden = true;
    this.emptyEl.hidden = true;
  }

  private showEditor(): void {
    this.applyBodyState("editor");
  }

  private showEmpty(message: string): void {
    this.emptyText.textContent = message;
    this.applyBodyState("empty");
    this.setSummary?.("");
  }

  private showHint(item: Zotero.Item): void {
    // Remember the item so the "switch to tab" button can focus it.
    this.itemID = item.id;
    this.applyBodyState("hint");
    this.setSummary?.("");
  }

  private async createNew(): Promise<void> {
    const parent = this.item && !this.item.isAttachment() ? this.item : null;
    const created = await createMarkdownAttachment(parent, {
      open: false,
      silent: true,
    });
    if (created) this.setItem(created, this.editable);
  }

  private async openInTab(): Promise<void> {
    const item = this.itemID != null ? Zotero.Items.get(this.itemID) : null;
    if (!item) return;
    await this.flush();
    const tabID = await openMarkdownTab(item, { win: this.win });
    if (!tabID) return;
    this.destroyEditor();
    this.showHint(item);
  }

  private renderList(
    ids: number[],
    seq: number,
    activeItemID = this.selectedItemID,
  ): void {
    this.listEl.replaceChildren();
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const card = this.win.document.createElement("button");
      card.type = "button";
      card.className = "zmd-sidebar-list-item";
      if (id === activeItemID) card.classList.add("is-active");

      const title = this.win.document.createElement("strong");
      // `getDisplayTitle` may return a Promise in some builds; only use it
      // when it is already a string, otherwise fall back to the filename.
      const fieldTitle = String(item.getField("title") || "");
      const display = item.getDisplayTitle?.();
      const displayTitle =
        display && typeof (display as { then?: unknown }).then !== "function"
          ? String(display)
          : "";
      title.textContent =
        fieldTitle ||
        displayTitle ||
        String(item.attachmentFilename || "") ||
        "Markdown";
      const meta = this.win.document.createElement("span");
      const date = item.dateModified
        ? new Date(item.dateModified).toLocaleDateString()
        : "";
      meta.textContent = date;
      card.append(title, meta);
      card.addEventListener("click", () => {
        const nextSeq = ++this.renderSeq;
        this.renderList(this.attachmentIDs, nextSeq, item.id);
        void this.openEditor(item, nextSeq);
      });
      this.listEl.appendChild(card);

      // Async snippet fill (abort if the list was re-rendered meanwhile)
      void (async () => {
        try {
          const path = await item.getFilePathAsync();
          if (seq !== this.renderSeq || !path) return;
          const content = await readFileText(path);
          if (seq !== this.renderSeq) return;
          const snippet = listSnippet(content);
          if (snippet && card.isConnected) {
            const el = this.win.document.createElement("span");
            el.className = "zmd-sidebar-list-snippet";
            el.textContent = snippet;
            card.appendChild(el);
          }
        } catch {
          // ignore
        }
      })();
    }
    this.listEl.hidden = false;
  }

  private async openEditor(
    item: Zotero.Item | null,
    seq: number,
  ): Promise<void> {
    if (this.destroyed || !item || seq !== this.renderSeq) return;
    if (canReuseSidebarEditor(!!this.editor, this.itemID, item.id)) {
      this.editor?.setReadOnly?.(!this.editable);
      this.showEditor();
      this.updateSummary();
      return;
    }

    this.beginLoading();

    // Flush and tear down the previous editor before switching documents.
    if (this.editor) {
      await this.flush();
      if (seq !== this.renderSeq || this.destroyed) return;
      this.destroyEditor();
    }
    if (seq !== this.renderSeq || this.destroyed) return;

    // A main-window tab already owns this document — don't create a second
    // editor; offer to switch to the tab instead.
    if (sessionRegistry.find(this.win, item.id)) {
      this.showHint(item);
      return;
    }

    const path = (await item.getFilePathAsync()) || null;
    if (seq !== this.renderSeq || this.destroyed) return;
    if (!path) {
      this.showEmpty(getString("sidebar-empty"));
      return;
    }
    const content = await readFileText(path);
    if (seq !== this.renderSeq || this.destroyed) return;

    this.itemID = item.id;
    this.showEditor();
    if (!this.editorHost.isConnected) {
      // The section body was detached between render and editor creation —
      // re-attach so the iframe actually loads (a detached iframe can lose
      // its load and never post "ready").
      ztoolkit.log("sidebar editor host detached; re-attaching root", {
        itemID: item.id,
      });
      if (this.root.parentElement)
        this.root.parentElement.appendChild(this.root);
    }

    this.editor = createMarkdownEditor(this.editorHost, {
      channel: `pane-${item.id}`,
      surface: "sidebar",
      doc: content,
      readOnly: !this.editable,
      onChange: () => {
        this.save?.markChanged();
        this.scheduleAutosave();
      },
      onSave: () => this.requestSave(true),
      onResolveAsset: (reference) => {
        const current = Zotero.Items.get(this.itemID ?? -1);
        return current
          ? resolveImageAssetEntry(current, reference)
          : Promise.resolve({ error: getString("sidebar-attachment-gone") });
      },
      onPasteImage: ({ bytes, mimeType }) => {
        void this.insertImage(new Uint8Array(bytes), mimeType);
      },
    });
    this.editor.setMode("live");
    this.save = new SaveCoordinator({
      getSnapshot: async () => ({
        rev: this.save?.currentRev ?? 0,
        value: (await this.editor?.requestSnapshot()) ?? "",
      }),
      write: async (value, request) => {
        await persistMarkdownContent(item, value, {
          cleanupImages: request.cleanupImages,
          syncTitle: true,
          syncFile: true,
        });
      },
      onStateChange: () => this.updateSummary(),
    });
    this.updateSummary();
    void this.refreshImages(item, content);
  }

  private destroyEditor(): void {
    if (this.autosaveTimer != null) {
      this.win.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.editor?.destroy();
    this.editor = null;
    this.save = null;
    this.itemID = null;
    this.editorHost.hidden = true;
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer != null) {
      this.win.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = this.win.setTimeout(() => {
      this.autosaveTimer = null;
      if (this.save?.dirty) {
        this.requestSave(false);
      }
    }, AUTOSAVE_DELAY_MS) as unknown as number;
  }

  private requestSave(force: boolean): void {
    if (!this.save) return;
    void this.save.request({ force }).catch((error) => {
      ztoolkit.log("Sidebar save failed", error);
      this.updateSummary();
    });
  }

  private async flush(): Promise<void> {
    if (this.save) {
      try {
        await this.save.request({ force: true });
      } catch (error) {
        ztoolkit.log("Sidebar flush failed", error);
      }
    }
  }

  private updateSummary(): void {
    if (!this.setSummary) return;
    const save = this.save;
    if (!save) {
      this.setSummary("");
      return;
    }
    if (save.lastError) this.setSummary(getString("sidebar-save-failed"));
    else if (save.dirty) this.setSummary(getString("sidebar-unsaved"));
    else this.setSummary(getString("sidebar-saved"));
  }

  private async refreshImages(
    item: Zotero.Item,
    source: string,
  ): Promise<void> {
    try {
      const assets = await resolveImageAssets(item, source);
      if (this.destroyed || this.itemID !== item.id) return;
      this.editor?.setImageAssets(assets);
    } catch (error) {
      ztoolkit.log("Sidebar image refresh failed", error);
    }
  }

  private async insertImage(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<void> {
    const seq = this.renderSeq;
    const itemID = this.itemID;
    if (itemID == null) return;
    try {
      const item = Zotero.Items.get(itemID);
      if (!item) throw new Error(getString("sidebar-attachment-gone"));
      const reference = await writeImageAsset(item, bytes, mimeType);
      // The user may have switched items while the asset was being written;
      // never insert into a document that is no longer the one we saved to.
      if (seq !== this.renderSeq || this.destroyed) return;
      this.editor?.insertText(`![](${reference})`, 2, 2);
      const asset = await resolveImageAssetEntry(item, reference);
      if (seq !== this.renderSeq || this.destroyed) return;
      // Single-asset push: merge so already-loaded images stay resolved.
      this.editor?.setImageAssets(
        { [reference]: asset } as ImageAssetMap,
        false,
      );
    } catch (error) {
      ztoolkit.log("Sidebar image insert failed", error);
    }
  }

  private applyFocusMode(body: HTMLElement, item: Zotero.Item | null): void {
    const enabled = shouldUseSidebarFocusMode(
      !!item && isMarkdownAttachment(item),
    );
    if (!enabled) {
      this.clearFocusMode();
      this.unbindFocusSidenav();
      this.focusItemID = null;
      this.focusSuppressed = false;
      return;
    }

    if (this.focusItemID !== item?.id) {
      this.focusItemID = item?.id ?? null;
      this.focusSuppressed = false;
    }

    const sectionCandidate = body.closest("item-pane-custom-section");
    const containerCandidate = sectionCandidate?.parentElement;
    if (
      !(sectionCandidate instanceof this.win.Element) ||
      !(containerCandidate instanceof this.win.HTMLElement)
    ) {
      return;
    }
    const section = sectionCandidate as Element;
    const container = containerCandidate as HTMLElement;
    const shellCandidate = container.parentElement;
    this.bindFocusSidenav(section);
    if (this.focusSuppressed) {
      this.clearFocusMode();
      return;
    }
    if (this.focusContainer === container && this.focusSection === section) {
      container.scrollTop = 0;
      return;
    }

    this.clearFocusMode();
    const collapsible = section.querySelector(
      "collapsible-section",
    ) as ZoteroCollapsibleSectionElement | null;
    this.focusContainer = container;
    this.focusShell =
      shellCandidate instanceof this.win.HTMLElement
        ? (shellCandidate as HTMLElement)
        : null;
    this.focusSection = section;
    this.focusCollapsible = collapsible;
    if (collapsible) {
      this.focusWasOpen = collapsible.open;
      this.focusWasCollapsible = collapsible.collapsible;
      collapsible.open = true;
      collapsible.collapsible = false;
    }

    const itemPane = section.closest(
      "item-pane",
    ) as ZoteroItemPaneElement | null;
    if (itemPane) itemPane.collapsed = false;
    container.style.removeProperty("--min-scroll-height");
    container.scrollTop = 0;
    container.classList.add("zmd-sidebar-focus-mode");
    this.focusShell?.classList.add("zmd-sidebar-focus-shell");
    section.classList.add("zmd-sidebar-focus-section");
    this.toolbar.hidden = false;
  }

  private readonly handleSidenavClick = (event: Event): void => {
    const target = event.target;
    if (!target || !(target instanceof this.win.Element)) return;
    const targetElement = target as Element;
    const button = targetElement.closest(".btn[data-pane]") as
      (Element & { dataset: DOMStringMap }) | null;
    const action = sidebarFocusAction(
      button?.dataset.pane ?? null,
      this.focusPaneID,
    );
    if (action === "release") {
      this.focusSuppressed = true;
      this.clearFocusMode();
      return;
    }
    if (action === "focus") {
      this.focusSuppressed = false;
      const body = this.root.parentElement;
      if (body && this.item) this.applyFocusMode(body, this.item);
    }
  };

  private bindFocusSidenav(section: Element): void {
    const paneID = section.getAttribute("data-pane");
    const paneHost = section.closest("item-pane, context-pane");
    const sidenav = paneHost?.querySelector("item-pane-sidenav") ?? null;
    if (sidenav === this.focusSidenav) {
      this.focusPaneID = paneID;
      return;
    }
    this.unbindFocusSidenav();
    const target = sidenav;
    if (!target || !(target instanceof this.win.Element)) return;
    const targetElement = target as Element;
    this.focusSidenav = targetElement;
    this.focusPaneID = paneID;
    targetElement.addEventListener("click", this.handleSidenavClick, true);
  }

  private unbindFocusSidenav(): void {
    this.focusSidenav?.removeEventListener(
      "click",
      this.handleSidenavClick,
      true,
    );
    this.focusSidenav = null;
    this.focusPaneID = null;
  }

  private clearFocusMode(): void {
    this.focusContainer?.classList.remove("zmd-sidebar-focus-mode");
    this.focusShell?.classList.remove("zmd-sidebar-focus-shell");
    this.focusSection?.classList.remove("zmd-sidebar-focus-section");
    if (this.focusCollapsible) {
      this.focusCollapsible.open = this.focusWasOpen;
      this.focusCollapsible.collapsible = this.focusWasCollapsible;
    }
    this.focusContainer = null;
    this.focusShell = null;
    this.focusSection = null;
    this.focusCollapsible = null;
    this.toolbar.hidden = true;
  }
}
