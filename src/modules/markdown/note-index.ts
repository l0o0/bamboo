import { extractNoteLinks, type NoteDocument } from "./note-links";

/** Match JS /iu's ASCII equivalences without SQLite's different Unicode folding. */
function candidateText(value: string): string {
  return value.replace(/[A-Z\u017f\u212a\0]/g, (character) =>
    character === "\u017f"
      ? "s"
      : character === "\0"
        ? " "
        : character.toLowerCase(),
  );
}

/** Only exact trigrams whose case equivalence is known may narrow candidates. */
export function noteSearchExpression(query: string): string | undefined {
  const phrases: string[] = [];
  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    let longest: string[] = [];
    let run: string[] = [];
    for (const character of candidateText(term)) {
      if (
        character !== "\0" &&
        (/^[a-z]$/.test(character) ||
          character.toLowerCase() === character.toUpperCase())
      ) {
        if (run.length < 32) run.push(character);
        if (run.length > longest.length) longest = [...run];
      } else run = [];
    }
    if (longest.length >= 3)
      phrases.push(`"${longest.join("").replace(/"/g, '""')}"`);
    // A bounded subset is sufficient for candidates; all terms are verified later.
    if (phrases.length === 16) break;
  }
  return phrases.length ? phrases.join(" AND ") : undefined;
}

/** Rebuildable cache only. Markdown files remain the source of truth. */
export class NoteIndex {
  private tail: Promise<unknown> = Promise.resolve();
  private db?: _ZoteroTypes.DB;
  private closing = false;
  private unavailable = false;
  private fullText = false;

  constructor(
    private readonly connect: () =>
      _ZoteroTypes.DB | undefined | Promise<_ZoteroTypes.DB | undefined>,
  ) {}

  private run<T>(
    fallback: T,
    operation: (db: _ZoteroTypes.DB) => Promise<T>,
  ): Promise<T> {
    if (this.closing || this.unavailable) return Promise.resolve(fallback);
    const result = this.tail.then(async () => {
      try {
        if (this.unavailable) return fallback;
        if (!this.db) {
          const db = await this.connect();
          if (!db) return fallback;
          this.db = db;
          const version = Number(
            await db.valueQueryAsync("PRAGMA user_version"),
          );
          if (![0, 1, 2].includes(version))
            throw new Error(`Unsupported note index version: ${version}`);
          await db.executeTransaction(async () => {
            await db.queryAsync(`CREATE TABLE IF NOT EXISTS notes (
              libraryID INTEGER NOT NULL, noteKey TEXT NOT NULL,
              filename TEXT NOT NULL, title TEXT NOT NULL, groupID INTEGER,
              path TEXT, modified REAL, size INTEGER, content TEXT NOT NULL,
              PRIMARY KEY (libraryID, noteKey))`);
            await db.queryAsync(`CREATE TABLE IF NOT EXISTS links (
              libraryID INTEGER NOT NULL, noteKey TEXT NOT NULL,
              position INTEGER NOT NULL, endPosition INTEGER NOT NULL,
              href TEXT NOT NULL, label TEXT NOT NULL, syntax TEXT NOT NULL,
              PRIMARY KEY (libraryID, noteKey, position, endPosition))`);
            await db.queryAsync(`CREATE TABLE IF NOT EXISTS notes_search_state (
              id INTEGER PRIMARY KEY, dirty INTEGER NOT NULL)`);
            await db.queryAsync(
              "INSERT OR IGNORE INTO notes_search_state (id, dirty) VALUES (1, 1)",
            );
            await db.queryAsync("PRAGMA user_version = 2");
          });
          await this.prepareFullText(db);
        }
        return await operation(this.db);
      } catch (error) {
        // A cache error must never turn a successful Markdown save into a failure.
        this.unavailable = true;
        (globalThis as any).Zotero?.logError?.(error);
        return fallback;
      }
    });
    this.tail = result;
    return result;
  }

  private async prepareFullText(db: _ZoteroTypes.DB): Promise<void> {
    try {
      const existing = await db.queryAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_search'",
      );
      await db.queryAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_search USING fts5(
        libraryID UNINDEXED, noteKey UNINDEXED, body, tokenize='trigram case_sensitive 1')`);
      const dirty = await db.valueQueryAsync(
        "SELECT dirty FROM notes_search_state WHERE id=1",
      );
      if (dirty || !existing?.length) {
        await db.executeTransaction(async () => {
          await db.queryAsync("DELETE FROM notes_search");
          const rows = await db.queryAsync(
            "SELECT libraryID, noteKey, filename, title, content FROM notes",
          );
          let count = 0;
          for (const row of rows ?? []) {
            await this.writeSearch(
              db,
              row.libraryID,
              row.noteKey,
              row.title,
              row.filename,
              row.content,
            );
            if (++count % 24 === 0)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          await db.queryAsync(
            "UPDATE notes_search_state SET dirty=0 WHERE id=1",
          );
        });
      }
      this.fullText = true;
    } catch {
      // FTS5/trigram are optional in host SQLite builds. Ordinary cache reads
      // and saves remain available, and candidates fall back to the live cache.
      this.fullText = false;
      await db.queryAsync("UPDATE notes_search_state SET dirty=1 WHERE id=1");
    }
  }

  private writeSearch(
    db: _ZoteroTypes.DB,
    libraryID: number,
    key: string,
    title: string,
    filename: string,
    content: string,
  ): Promise<unknown> {
    return db.queryAsync(
      `INSERT INTO notes_search (rowid, libraryID, noteKey, body)
       SELECT rowid, libraryID, noteKey, ? FROM notes WHERE libraryID=? AND noteKey=?`,
      [candidateText(`${title}\n${filename}\n${content}`), libraryID, key],
    );
  }

  /** Undefined means no safe/available index; callers must scan, never return no matches. */
  searchCandidateKeys(
    libraryID: number,
    query: string,
  ): Promise<Set<string> | undefined> {
    const expression = noteSearchExpression(query);
    if (!expression) return Promise.resolve(undefined);
    return this.run<Set<string> | undefined>(undefined, async (db) => {
      if (!this.fullText) return undefined;
      const rows = await db.queryAsync(
        "SELECT noteKey FROM notes_search WHERE notes_search MATCH ? AND libraryID=?",
        [expression, libraryID],
      );
      return new Set((rows ?? []).map((row) => String(row.noteKey)));
    });
  }

  private async deleteSearch(
    db: _ZoteroTypes.DB,
    libraryID: number,
    key: string,
  ): Promise<void> {
    if (this.fullText)
      await db.queryAsync(
        "DELETE FROM notes_search WHERE rowid IN (SELECT rowid FROM notes WHERE libraryID=? AND noteKey=?)",
        [libraryID, key],
      );
    else
      await db.queryAsync("UPDATE notes_search_state SET dirty=1 WHERE id=1");
  }

  load(libraryID: number): Promise<NoteDocument[]> {
    return this.run([], async (db) => {
      const rows = await db.queryAsync(
        "SELECT * FROM notes WHERE libraryID=?",
        [libraryID],
      );
      const notes = new Map<string, NoteDocument>();
      for (const row of rows ?? []) {
        notes.set(row.noteKey, {
          libraryID,
          key: row.noteKey,
          filename: row.filename,
          title: row.title,
          ...(row.groupID != null ? { groupID: row.groupID } : {}),
          ...(row.path ? { path: row.path } : {}),
          ...(row.modified != null && row.size != null
            ? { fileModified: row.modified, fileSize: row.size }
            : {}),
          content: row.content,
          links: [],
        });
      }
      const links = await db.queryAsync(
        "SELECT * FROM links WHERE libraryID=? ORDER BY noteKey, position",
        [libraryID],
      );
      for (const row of links ?? [])
        notes.get(row.noteKey)?.links?.push({
          from: row.position,
          to: row.endPosition,
          href: row.href,
          label: row.label,
          syntax: row.syntax,
        });
      return [...notes.values()];
    });
  }

  private async write(db: _ZoteroTypes.DB, note: NoteDocument): Promise<void> {
    await this.deleteSearch(db, note.libraryID, note.key);
    await db.queryAsync("DELETE FROM links WHERE libraryID=? AND noteKey=?", [
      note.libraryID,
      note.key,
    ]);
    if (note.readError) {
      await db.queryAsync("DELETE FROM notes WHERE libraryID=? AND noteKey=?", [
        note.libraryID,
        note.key,
      ]);
      return;
    }
    await db.queryAsync(
      `INSERT OR REPLACE INTO notes
      (libraryID, noteKey, filename, title, groupID, path, modified, size, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.libraryID,
        note.key,
        note.filename,
        note.title,
        note.groupID ?? null,
        note.path ?? null,
        note.fileModified ?? null,
        note.fileSize ?? null,
        note.content,
      ],
    );
    if (this.fullText)
      await this.writeSearch(
        db,
        note.libraryID,
        note.key,
        note.title,
        note.filename,
        note.content,
      );
    for (const link of note.links ?? extractNoteLinks(note.content)) {
      await db.queryAsync(
        `INSERT INTO links
        (libraryID, noteKey, position, endPosition, href, label, syntax)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          note.libraryID,
          note.key,
          link.from,
          link.to,
          link.href,
          link.label,
          link.syntax,
        ],
      );
    }
  }

  save(note: NoteDocument): Promise<boolean> {
    return this.run(false, (db) =>
      db.executeTransaction(async () => {
        await this.write(db, note);
        return true;
      }),
    );
  }

  /** Reconcile deletions only after a successful, still-current library scan. */
  replace(
    libraryID: number,
    notes: NoteDocument[],
    isCurrent: () => boolean,
    force = false,
  ): Promise<boolean> {
    return this.run(false, async (db) => {
      if (!isCurrent()) return false;
      return db
        .executeTransaction(async () => {
          // Throwing rolls back the whole scan if a save or invalidation overtakes it.
          const check = () => {
            if (!isCurrent()) throw new StaleScan();
          };
          check();
          const keys = new Set(notes.map((note) => note.key));
          const old = await db.queryAsync(
            "SELECT * FROM notes WHERE libraryID=?",
            [libraryID],
          );
          for (const row of old ?? [])
            if (!keys.has(row.noteKey)) {
              await this.deleteSearch(db, libraryID, row.noteKey);
              await db.queryAsync(
                "DELETE FROM links WHERE libraryID=? AND noteKey=?",
                [libraryID, row.noteKey],
              );
              await db.queryAsync(
                "DELETE FROM notes WHERE libraryID=? AND noteKey=?",
                [libraryID, row.noteKey],
              );
            }
          const existing = new Map(
            (old ?? []).map((row) => [row.noteKey, row]),
          );
          let written = 0;
          for (const note of notes) {
            if (++written % 24 === 0)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            check();
            const row = existing.get(note.key);
            if (
              !force &&
              row &&
              !note.readError &&
              row.filename === note.filename &&
              row.title === note.title &&
              row.groupID === (note.groupID ?? null) &&
              row.path === (note.path ?? null) &&
              row.modified === (note.fileModified ?? null) &&
              row.size === (note.fileSize ?? null) &&
              row.content === note.content
            )
              continue;
            await this.write(db, note);
          }
          check();
          return true;
        })
        .catch((error) => {
          if (!(error instanceof StaleScan)) throw error;
          return false;
        });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.tail;
    try {
      await this.db?.closeDatabase(true);
    } catch (error) {
      (globalThis as any).Zotero?.logError?.(error);
    }
  }
}

class StaleScan extends Error {}

/** Prepare the plugin directory before opening SQLite. */
export async function connectNoteIndex(): Promise<_ZoteroTypes.DB | undefined> {
  const api = (globalThis as any).Zotero;
  if (
    !api?.DBConnection ||
    !api.DataDirectory?.dir ||
    typeof PathUtils === "undefined" ||
    typeof IOUtils === "undefined"
  )
    return undefined;
  const directory = PathUtils.join(api.DataDirectory.dir, "scholar-canvas");
  const path = PathUtils.join(directory, "scholar-canvas.sqlite");
  await IOUtils.makeDirectory(directory, { ignoreExisting: true });
  return new api.DBConnection(path);
}

let index: NoteIndex | undefined;
export function noteIndex(): NoteIndex {
  return (index ??= new NoteIndex(connectNoteIndex));
}

export async function closeNoteIndex(): Promise<void> {
  const current = index;
  await current?.close();
}
