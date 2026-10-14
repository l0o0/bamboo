import { getString } from "../../utils/locale";
import {
  readLibrarySearchCandidates,
  subscribeNoteLibrary,
} from "./note-library";
import { formatNoteLink, type NoteDocument } from "./note-links";
import { openDocumentLink } from "./document-links";

function searchTerms(query: string): RegExp[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"),
    );
}

export interface NoteSearchMatch {
  note: NoteDocument;
  position: number;
  snippet: string;
}

function matchNote(
  note: NoteDocument,
  terms: readonly RegExp[],
): NoteSearchMatch | undefined {
  if (note.readError || !terms.length) return undefined;
  const searchable = `${note.title}\n${note.filename}\n${note.content}`;
  if (!terms.every((term) => term.test(searchable))) return undefined;
  const position =
    terms
      .map((term) => term.exec(note.content)?.index)
      .find((index) => index !== undefined) ?? 0;
  const from = Math.max(0, position - 60);
  return {
    note,
    position,
    snippet: `${from ? "…" : ""}${note.content.slice(from, position + 180).replace(/\s+/g, " ")}`,
  };
}

export function searchNotes(
  notes: readonly NoteDocument[],
  query: string,
): NoteSearchMatch[] {
  const terms = searchTerms(query);
  return notes
    .map((note) => matchNote(note, terms))
    .filter((match): match is NoteSearchMatch => Boolean(match));
}

export interface NoteSearchResult {
  matches: NoteSearchMatch[];
  total: number;
  cancelled: boolean;
}

/** Keep result DOM bounded and yield between chunks, including fallback scans. */
export async function searchNotesAsync(
  notes: readonly NoteDocument[],
  query: string,
  options: {
    isCancelled?: () => boolean;
    limit?: number;
    onProgress?: (result: NoteSearchResult) => void;
  } = {},
): Promise<NoteSearchResult> {
  const terms = searchTerms(query);
  const result: NoteSearchResult = { matches: [], total: 0, cancelled: false };
  const cancelled = () => Boolean(options.isCancelled?.());
  if (!terms.length) return result;
  const limit = Math.max(0, options.limit ?? 100);
  let started = Date.now();
  for (let index = 0; index < notes.length; index += 1) {
    if (cancelled()) return { ...result, cancelled: true };
    const match = matchNote(notes[index], terms);
    if (match) {
      result.total += 1;
      if (result.matches.length < limit) result.matches.push(match);
    }
    if ((index + 1) % 24 === 0 || Date.now() - started >= 8) {
      options.onProgress?.(result);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      started = Date.now();
    }
  }
  return { ...result, cancelled: cancelled() };
}

export async function showNoteSearch(win: Window, currentItem: Zotero.Item) {
  const doc = win.document;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
  const dialog = element("dialog");
  dialog.style.cssText =
    "width:min(760px,85vw);max-height:80vh;padding:24px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:10px";
  dialog.setAttribute("aria-label", getString("more-search-library"));
  const title = element("h2");
  title.textContent = getString("more-search-library");
  const query = element("input");
  query.type = "search";
  query.placeholder = getString("note-search-placeholder");
  query.setAttribute("aria-label", query.placeholder);
  query.style.cssText = "width:100%;box-sizing:border-box;padding:8px";
  const status = element("p");
  status.setAttribute("role", "status");
  const results = element("div");
  results.style.cssText = "max-height:50vh;overflow:auto;display:grid;gap:8px";
  const close = element("button");
  close.type = "button";
  close.textContent = getString("file-history-close");
  close.addEventListener("click", () => dialog.close());
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const search = async () => {
    const token = ++sequence;
    results.replaceChildren();
    if (!query.value.trim()) {
      status.textContent = getString("note-search-hint");
      return;
    }
    status.textContent = getString("note-search-loading");
    try {
      const text = query.value;
      const isCancelled = () => token !== sequence || !dialog.isConnected;
      const notes = await readLibrarySearchCandidates(
        currentItem.libraryID,
        text,
        isCancelled,
      );
      if (isCancelled()) return;
      let rendered = 0;
      const renderMatches = (matches: NoteSearchMatch[]) => {
        if (isCancelled()) return;
        for (const match of matches.slice(rendered)) {
          rendered += 1;
          const button = element("button");
          button.type = "button";
          button.style.cssText =
            "text-align:start;white-space:normal;padding:10px";
          const heading = element("strong");
          heading.textContent = match.note.title || match.note.filename;
          const snippet = element("div");
          snippet.textContent = match.snippet;
          button.append(heading, snippet);
          button.addEventListener("click", () => {
            void openDocumentLink(formatNoteLink(match.note), {
              currentItem,
              win,
              position: match.position,
            })
              .then((result) => {
                if (result.status === "opened") dialog.close();
                else status.textContent = getString("document-link-unresolved");
              })
              .catch((error) => {
                status.textContent = String(error);
              });
          });
          results.append(button);
        }
      };
      const result = await searchNotesAsync(notes, text, {
        isCancelled,
        onProgress: (partial) => renderMatches(partial.matches),
      });
      if (result.cancelled || isCancelled()) return;
      renderMatches(result.matches);
      status.textContent = getString("note-search-count", {
        args: { count: result.total },
      });
    } catch (error) {
      if (token === sequence) status.textContent = String(error);
    }
  };
  const scheduleSearch = () => {
    sequence++;
    clearTimeout(timer);
    results.replaceChildren();
    timer = setTimeout(() => void search(), 150);
  };
  query.addEventListener("input", scheduleSearch);
  const unsubscribe = subscribeNoteLibrary((libraryID) => {
    if (libraryID === currentItem.libraryID) scheduleSearch();
  });
  const dispose = () => {
    sequence++;
    clearTimeout(timer);
    unsubscribe();
    win.removeEventListener("unload", dispose);
  };
  win.addEventListener("unload", dispose, { once: true });
  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      results.querySelector("button")?.click();
    }
  });
  const previous = doc.activeElement as HTMLElement | null;
  dialog.addEventListener(
    "close",
    () => {
      dispose();
      dialog.remove();
      previous?.focus();
    },
    { once: true },
  );
  dialog.append(title, query, status, results, close);
  doc.documentElement.append(dialog);
  dialog.showModal();
  query.focus();
  await search();
}
