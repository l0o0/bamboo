import type { MarkdownEditorHandle } from "./editor";
import type { EditorOutlineItem } from "./editor-protocol";
import type { OutlineSidebarHandle } from "./outline-sidebar";
import type { SaveCoordinator } from "./save-coordinator";
import type { MarkdownModalController } from "./modal";

export type SessionMode = "live" | "source" | "preview";
export type SessionSurface = "tab" | "window";

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
  surface: SessionSurface;
  sourceID: string;
  itemID: number;
  path: string;
  win: Window;
  isActive: () => boolean;
  updateTitle: () => void;
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
  unbindPreviewOutline?: () => void;
  modal?: MarkdownModalController;
}

export class SessionRegistry {
  private readonly byTab = new Map<string, OpenSession>();
  private readonly byWindow = new WeakMap<
    Window,
    Map<string, Map<number, string>>
  >();

  get(tabID: string) {
    return this.byTab.get(tabID);
  }

  find(win: Window, itemID: number, surface: SessionSurface = "tab") {
    const tabID = this.byWindow.get(win)?.get(surface)?.get(itemID);
    return tabID ? this.byTab.get(tabID) : undefined;
  }

  register(session: OpenSession) {
    this.byTab.set(session.tabID, session);
    let surfaces = this.byWindow.get(session.win);
    if (!surfaces) {
      surfaces = new Map();
      this.byWindow.set(session.win, surfaces);
    }
    let items = surfaces.get(session.surface);
    if (!items) {
      items = new Map();
      surfaces.set(session.surface, items);
    }
    items.set(session.itemID, session.tabID);
  }

  unregister(tabID: string) {
    const session = this.byTab.get(tabID);
    if (!session) return;
    this.byTab.delete(tabID);
    this.byWindow
      .get(session.win)
      ?.get(session.surface)
      ?.delete(session.itemID);
  }

  sessionsForWindow(win: Window) {
    const surfaces = this.byWindow.get(win);
    if (!surfaces) return [];
    return [...surfaces.values()]
      .flatMap((items) => [...items.values()])
      .map((tabID) => this.byTab.get(tabID))
      .filter((session): session is OpenSession => !!session);
  }

  all() {
    return [...this.byTab.values()];
  }

  tabs() {
    return this.all().filter((session) => session.surface === "tab");
  }
}

export const sessionRegistry = new SessionRegistry();
