import { getString } from "../../utils/locale";
import { openDocumentLink } from "./document-links";
import {
  getNoteBacklinks,
  bindNoteLibraryWindow,
  rebuildNoteLibrary,
  subscribeNoteLibrary,
  type NoteReadFailure,
} from "./note-library";
import type { PortableNote } from "./note-links";
import { createSidebarMotion } from "./sidebar-motion";

/** Keep sidebar visibility independent from the currently displayed note. */
export function mountBacklinksSidebar(
  root: HTMLElement,
  sidebar: HTMLElement,
  toggle: HTMLButtonElement,
  onLayoutChange?: () => void,
): () => void {
  let expanded: boolean | undefined;
  let visible: boolean | undefined;
  let narrow: boolean | undefined;
  let previousWidth: number | undefined;
  const motion = createSidebarMotion(sidebar, toggle, "right");
  const sync = (animate = false) => {
    const width = root.getBoundingClientRect().width || root.clientWidth;
    const widthChanged = previousWidth !== width;
    previousWidth = width;
    const nextNarrow = width > 0 && width < 1000;
    const nextVisible = expanded ?? !nextNarrow;
    if (nextVisible === visible && nextNarrow === narrow) {
      if (widthChanged) motion.finish();
      return;
    }
    const wasDocked = visible === true && narrow === false;
    visible = nextVisible;
    narrow = nextNarrow;
    motion.update(
      visible,
      () => {
        sidebar.hidden = !nextVisible;
        sidebar.classList.toggle("is-floating", nextNarrow);
        toggle.setAttribute("aria-expanded", String(nextVisible));
      },
      animate,
    );
    if (wasDocked !== (visible && !narrow)) onLayoutChange?.();
  };
  const onToggle = () => {
    expanded = !visible;
    sync(true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    expanded = false;
    sync(true);
    toggle.focus();
    event.preventDefault();
  };
  if (sidebar.id) toggle.setAttribute("aria-controls", sidebar.id);
  toggle.addEventListener("click", onToggle);
  sidebar.addEventListener("keydown", onKeyDown);
  const ResizeObserverCtor = root.ownerDocument.defaultView?.ResizeObserver;
  const observer = ResizeObserverCtor
    ? new ResizeObserverCtor(() => sync())
    : null;
  observer?.observe(root);
  sync();
  return () => {
    observer?.disconnect();
    motion.destroy();
    toggle.removeEventListener("click", onToggle);
    sidebar.removeEventListener("keydown", onKeyDown);
  };
}

/** The same saved-note backlinks panel is used by tabs, windows and the lab. */
export function mountNoteBacklinks(
  parent: HTMLElement,
  item: Zotero.Item,
  win: Window,
  options: {
    fullHeight?: boolean;
    onNavigateNote?: (
      note: PortableNote,
      heading?: string,
      position?: number,
    ) => boolean | Promise<boolean>;
    labels?: {
      title: string;
      refresh: string;
      loading: string;
      empty: string;
      incomplete: string;
      failed: string;
      failureSummary?: string;
      notDownloaded?: string;
      unavailable?: string;
      readError?: string;
      indexError?: string;
      locateNote?: string;
      moreFailures?: string;
    };
  } = {},
): () => void {
  const labels: NonNullable<typeof options.labels> = options.labels ?? {
    title: getString("note-backlinks-title"),
    refresh: getString("note-backlinks-refresh"),
    loading: getString("note-backlinks-loading"),
    empty: getString("note-backlinks-empty"),
    incomplete: getString("note-backlinks-incomplete"),
    failed: getString("note-backlinks-failed"),
  };
  const doc = parent.ownerDocument;
  const panel = doc.createElement("details");
  panel.className = "zmd-backlinks";
  panel.open = true;
  panel.style.cssText =
    "flex:0 1 auto;max-height:40%;min-height:34px;overflow:auto;padding:10px;border-top:1px solid var(--zmd-border,#d8dee8);font:inherit;color:inherit";
  if (options.fullHeight) {
    panel.style.maxHeight = "none";
    panel.style.borderTop = "0";
    panel.style.flex = "1 1 auto";
  }
  const summary = doc.createElement("summary");
  const heading = doc.createElement("span");
  heading.textContent = labels.title;
  const count = doc.createElement("span");
  count.className = "zmd-backlinks-count";
  summary.append(heading, count);
  summary.style.cursor = "pointer";
  const refresh = doc.createElement("button");
  refresh.type = "button";
  refresh.textContent = labels.refresh;
  refresh.className = "zmd-backlinks-refresh";
  summary.append(refresh);
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:12px;white-space:pre-wrap";
  const failures = doc.createElement("details");
  failures.className = "zmd-backlinks-failures";
  failures.hidden = true;
  failures.style.cssText = "font-size:12px;margin:8px 0 12px";
  const failureSummary = doc.createElement("summary");
  const failureList = doc.createElement("ul");
  failureList.style.cssText = "list-style:none;padding:0;margin:8px 0";
  failures.append(failureSummary, failureList);
  const list = doc.createElement("div");
  panel.append(summary, status, failures, list);
  parent.append(panel);
  let disposed = false;
  let generation = 0;

  const failureLabel = (reason: NoteReadFailure["reason"]) => {
    if (reason === "not-downloaded")
      return labels.notDownloaded ?? getString("note-backlinks-not-downloaded");
    if (reason === "unavailable")
      return labels.unavailable ?? getString("note-backlinks-unavailable");
    if (reason === "index-error")
      return labels.indexError ?? getString("note-backlinks-index-error");
    return labels.readError ?? getString("note-backlinks-read-error");
  };

  const renderFailures = (values: readonly NoteReadFailure[]) => {
    failures.hidden = values.length === 0;
    failureList.replaceChildren();
    failureSummary.textContent = `${
      labels.failureSummary ?? getString("note-backlinks-failure-summary")
    } (${values.length})`;
    const api = (globalThis as { Zotero?: any }).Zotero;
    const pane =
      (win as _ZoteroTypes.MainWindow).ZoteroPane ||
      api?.getActiveZoteroPane?.();
    const canLocate =
      typeof pane?.selectItem === "function" &&
      typeof api?.Items?.getByLibraryAndKey === "function";
    for (const failure of values.slice(0, 10)) {
      const row = doc.createElement("li");
      row.style.marginBlock = "6px";
      const title = doc.createElement(canLocate ? "button" : "span");
      title.textContent = failure.title;
      if (title.tagName.toLowerCase() === "button") {
        const button = title as HTMLButtonElement;
        button.type = "button";
        button.title =
          labels.locateNote ?? getString("note-backlinks-locate-note");
        button.dataset.noteKey = failure.key;
        button.style.cssText =
          "padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:start;text-decoration:underline;cursor:pointer;overflow-wrap:anywhere";
        button.onclick = () => {
          if (disposed) return;
          void (async () => {
            const source = api?.Items?.getByLibraryAndKey?.(
              item.libraryID,
              failure.key,
            );
            if (source && !disposed) await pane.selectItem(source.id);
          })().catch(() => {
            if (!disposed) status.textContent = labels.failed;
          });
        };
      }
      const reason = doc.createElement("span");
      reason.style.cssText =
        "display:block;color:var(--zmd-text-muted);margin-top:2px";
      reason.textContent = failureLabel(failure.reason);
      row.append(title, reason);
      failureList.append(row);
    }
    if (values.length > 10) {
      const more = doc.createElement("li");
      more.textContent = `${labels.moreFailures ?? getString("note-backlinks-more-failures")} (${values.length - 10})`;
      failureList.append(more);
    }
  };

  async function render() {
    const current = ++generation;
    refresh.disabled = true;
    status.textContent = labels.loading;
    try {
      const result = await getNoteBacklinks(item);
      if (disposed || current !== generation) return;
      list.replaceChildren();
      renderFailures(result.failures);
      count.textContent = `(${result.entries.length})`;
      status.textContent = result.unreadable
        ? `${labels.incomplete} (${result.unreadable})`
        : result.entries.length
          ? ""
          : labels.empty;
      for (const entry of result.entries) {
        const button = doc.createElement("button");
        button.type = "button";
        button.title = entry.filename;
        button.style.cssText =
          "display:block;width:100%;text-align:start;padding:8px 0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere";
        const title = doc.createElement("strong");
        title.textContent = entry.title;
        const excerpt = doc.createElement("span");
        excerpt.textContent = entry.excerpt;
        excerpt.style.cssText = "display:block;font-size:12px;opacity:.75";
        button.append(title, excerpt);
        button.onclick = () => {
          void openDocumentLink(entry.href, {
            currentItem: item,
            win,
            position: entry.position,
            onNavigateNote: options.onNavigateNote,
          })
            .then((result) => {
              if (!disposed && result.status !== "opened")
                status.textContent = labels.failed;
            })
            .catch((error) => {
              if (!disposed)
                status.textContent = `${labels.failed}: ${String(error)}`;
            });
        };
        list.append(button);
      }
    } catch (error) {
      if (!disposed && current === generation) {
        list.replaceChildren();
        renderFailures([]);
        status.textContent = `${labels.failed}: ${String(error)}`;
      }
    } finally {
      if (!disposed && current === generation) refresh.disabled = false;
    }
  }
  const unbindWindow = bindNoteLibraryWindow(win);
  const unsubscribe = subscribeNoteLibrary((libraryID) => {
    if (libraryID === item.libraryID) void render();
  });
  refresh.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    refresh.disabled = true;
    void rebuildNoteLibrary(item.libraryID).catch((error) => {
      if (!disposed) {
        status.textContent = `${labels.failed}: ${String(error)}`;
        refresh.disabled = false;
      }
    });
  };
  void render();
  return () => {
    disposed = true;
    generation++;
    unsubscribe();
    unbindWindow();
    panel.remove();
  };
}
