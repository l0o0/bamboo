export type SidebarBodyState = "editor" | "hint" | "empty";
export type SidebarLifecycleEvent = "init" | "itemChange" | "render" | "toggle";

export class SidebarControllerRegistry<
  TWindow extends object,
  TBody extends object,
  TController extends object,
> {
  private readonly byBody = new WeakMap<TBody, TController>();
  private readonly bodyByController = new WeakMap<TController, TBody>();
  private readonly windowByController = new WeakMap<TController, TWindow>();
  private readonly byWindow = new WeakMap<TWindow, Set<TController>>();

  bind(win: TWindow, body: TBody, controller: TController): void {
    const existing = this.byBody.get(body);
    if (existing) {
      const existingWindow = this.windowByController.get(existing);
      if (existingWindow) {
        this.byWindow.get(existingWindow)?.delete(existing);
      }
      this.bodyByController.delete(existing);
      this.windowByController.delete(existing);
    }

    this.byBody.set(body, controller);
    this.bodyByController.set(controller, body);
    this.windowByController.set(controller, win);
    let windowControllers = this.byWindow.get(win);
    if (!windowControllers) {
      windowControllers = new Set<TController>();
      this.byWindow.set(win, windowControllers);
    }
    windowControllers.add(controller);
  }

  get(body: TBody): TController | undefined {
    return this.byBody.get(body);
  }

  release(win: TWindow, body: TBody): TController | undefined {
    const controller = this.byBody.get(body);
    if (!controller || this.windowByController.get(controller) !== win) {
      return undefined;
    }

    this.byBody.delete(body);
    this.bodyByController.delete(controller);
    this.windowByController.delete(controller);
    this.byWindow.get(win)?.delete(controller);
    return controller;
  }

  releaseWindow(win: TWindow): TController[] {
    const controllers = Array.from(this.byWindow.get(win) ?? []);
    this.byWindow.delete(win);
    for (const controller of controllers) {
      const body = this.bodyByController.get(controller);
      if (body) this.byBody.delete(body);
      this.bodyByController.delete(controller);
      this.windowByController.delete(controller);
    }
    return controllers;
  }
}

export interface SidebarVisibility {
  list: boolean;
  editor: boolean;
  hint: boolean;
  empty: boolean;
}

export function planSidebarVisibility(
  state: SidebarBodyState,
  hasAttachmentList: boolean,
): SidebarVisibility {
  return {
    list: hasAttachmentList && state !== "empty",
    editor: state === "editor",
    hint: state === "hint",
    empty: state === "empty",
  };
}

export function canReuseSidebarEditor(
  hasEditor: boolean,
  currentItemID: number | null,
  targetItemID: number,
): boolean {
  return hasEditor && currentItemID === targetItemID;
}

/** Zotero only permits section UI creation from the synchronous render hook. */
export function shouldMountSidebarUI(event: SidebarLifecycleEvent): boolean {
  return event === "render";
}

export function shouldUseSidebarFocusMode(
  itemIsMarkdownAttachment: boolean,
): boolean {
  return itemIsMarkdownAttachment;
}

export type SidebarFocusAction = "focus" | "release" | "ignore";

export function sidebarFocusAction(
  paneID: string | null,
  markdownPaneID: string | null,
): SidebarFocusAction {
  if (!paneID) return "ignore";
  return paneID === markdownPaneID ? "focus" : "release";
}
