import type { MarkdownEditorHandle } from "./editor";
import type { EditorOutlineItem } from "./editor-protocol";
import type { OutlineSidebarHandle } from "./outline-sidebar";
import type { SaveCoordinator } from "./save-coordinator";
import type { MarkdownModalController } from "./modal";

export type SessionMode = "live" | "source" | "preview";

export interface SessionView {
  root: HTMLElement;
  editorHost: HTMLElement;
  previewEl: HTMLElement;
  outlineSidebarEl: HTMLElement;
  outlineListEl: HTMLElement;
  outlineToggleEl: HTMLButtonElement;
  workspaceEl: HTMLElement;
  metaEl: HTMLElement;
  saveStatusEl: HTMLElement;
}

export interface OpenSession {
  tabID: string;
  itemID: number;
  path: string;
  win: _ZoteroTypes.MainWindow;
  save: SaveCoordinator;
  storageLabel: string;
  mode: SessionMode;
  previewRenderGeneration?: number;
  view?: SessionView;
  editor?: MarkdownEditorHandle;
  outlineItems?: EditorOutlineItem[];
  outlineActiveID?: string | null;
  outlineExpanded?: boolean;
  outlineSidebar?: OutlineSidebarHandle;
  savedAt?: Date;
  autosaveTimer?: number;
  imageRefreshTimer?: number;
  pendingImageSave?: boolean;
  titleSyncTimer?: number;
  applyingTitleSync?: boolean;
  pendingExplicitSave?: boolean;
  pendingImageCleanup?: boolean;
  closing?: boolean;
  closePromise?: Promise<void>;
  closeMoreMenu?: () => void;
  closeTablePicker?: () => void;
  unbindTablePicker?: () => void;
  unbindTheme?: () => void;
  documentSyncSourceID?: string;
  documentSyncRefresh?: Promise<void>;
  unbindDocumentSync?: () => void;
  modal?: MarkdownModalController;
}

export class SessionRegistry {
  private readonly byTab = new Map<string, OpenSession>();
  private readonly byWindow = new WeakMap<Window, Map<number, string>>();

  get(tabID: string) {
    return this.byTab.get(tabID);
  }

  find(win: Window, itemID: number) {
    const tabID = this.byWindow.get(win)?.get(itemID);
    return tabID ? this.byTab.get(tabID) : undefined;
  }

  register(session: OpenSession) {
    this.byTab.set(session.tabID, session);
    let items = this.byWindow.get(session.win);
    if (!items) {
      items = new Map();
      this.byWindow.set(session.win, items);
    }
    items.set(session.itemID, session.tabID);
  }

  unregister(tabID: string) {
    const session = this.byTab.get(tabID);
    if (!session) return;
    this.byTab.delete(tabID);
    this.byWindow.get(session.win)?.delete(session.itemID);
  }

  sessionsForWindow(win: Window) {
    const items = this.byWindow.get(win);
    if (!items) return [];
    return [...items.values()]
      .map((tabID) => this.byTab.get(tabID))
      .filter((session): session is OpenSession => !!session);
  }

  all() {
    return [...this.byTab.values()];
  }
}

export const sessionRegistry = new SessionRegistry();
