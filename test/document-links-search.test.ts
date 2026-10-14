import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Window } from "happy-dom";
import { tmpdir } from "node:os";
import {
  NoteIndex,
  noteSearchExpression,
  closeNoteIndex,
} from "../src/modules/markdown/note-index.ts";
import {
  searchNotes,
  searchNotesAsync,
  showNoteSearch,
} from "../src/modules/markdown/search.ts";
import {
  clearNoteLibraries,
  invalidateNoteLibrary,
  readLibrarySearchCandidates,
  updateIndexedNote,
} from "../src/modules/markdown/note-library.ts";
import type { NoteDocument } from "../src/modules/markdown/note-links.ts";

function connection(
  path = ":memory:",
  options: { noFts?: boolean; failWrite?: boolean } = {},
) {
  const raw = new DatabaseSync(path);
  const queries: string[] = [];
  const api = {
    async queryAsync(sql: string, params: any[] = []) {
      queries.push(sql);
      if (options.noFts && /CREATE VIRTUAL TABLE/.test(sql))
        throw new Error("no such tokenizer: trigram");
      if (options.failWrite && sql.startsWith("INSERT INTO notes_search"))
        throw new Error("injected index write failure");
      const statement = raw.prepare(sql);
      return statement.columns().length
        ? statement.all(...params)
        : (statement.run(...params), []);
    },
    async valueQueryAsync(sql: string) {
      return Object.values(raw.prepare(sql).get()!)[0];
    },
    async executeTransaction(fn: () => Promise<unknown>) {
      raw.exec("BEGIN");
      try {
        const result = await fn();
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    async closeDatabase() {
      raw.close();
    },
  };
  return { raw, queries, api: api as any };
}

function note(
  key: string,
  content: string,
  extra: Partial<NoteDocument> = {},
): NoteDocument {
  return {
    key,
    libraryID: 1,
    filename: `${key}.md`,
    title: key,
    content,
    ...extra,
  };
}

function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), "scholar-search-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "index.sqlite");
}

test("FTS candidates preserve literal Unicode substring semantics, multi-term AND, and library scope", async () => {
  const db = connection();
  const index = new NoteIndex(() => db.api);
  const notes = [
    note("TITLE", "Header\n😀 opening [a+b] 中文全文搜索", {
      title: "Research method",
      filename: "REPORT.md",
    }),
    note("CASE", "ſky and KELVIN, İSTANBUL, ΟΣΑ, ẞ, über, 😀😃😄, abc\0def"),
    note("LITERAL", 'a"b* ; DROP TABLE notes; --'),
    note("OTHER", "no matching body"),
    note("READERROR", "research", { readError: "missing" }),
  ];
  await index.replace(1, notes, () => true);
  await index.save(note("FOREIGN", "Research 中文全文搜索", { libraryID: 2 }));
  for (const query of [
    "research 中文全文",
    "REPORT [a+b]",
    "a+b",
    "中文",
    "中文全文搜索",
    "sky",
    "kelvin",
    "İSTANBUL",
    "istanbul",
    "οσ",
    "οςα",
    "ß",
    "ÜBER",
    "😀😃😄",
    'a"b*',
    "DROP TABLE",
    "def",
    "abc\0def",
    "no matching",
    "missing",
  ]) {
    const candidates = await index.searchCandidateKeys(1, query);
    const selected = candidates
      ? notes.filter((entry) => candidates.has(entry.key))
      : notes;
    const expected = searchNotes(notes, query);
    const actual = searchNotes(selected, query);
    assert.deepEqual(
      actual.map((match) => [match.note.key, match.position]),
      expected.map((match) => [match.note.key, match.position]),
      query,
    );
  }
  assert.deepEqual(
    [...(await index.searchCandidateKeys(1, "research"))!],
    ["TITLE"],
  );
  assert.equal(await index.searchCandidateKeys(1, "中文"), undefined);
  assert.equal(await index.searchCandidateKeys(1, "ΟΣΑ"), undefined);
  assert.ok(db.queries.some((sql) => sql.includes("MATCH ?")));
  await index.close();
});

test("candidate query fragments stay bounded and quote FTS syntax as literals", () => {
  assert.equal(noteSearchExpression("ab"), undefined);
  assert.equal(noteSearchExpression('a"b'), '"a""b"');
  assert.equal(noteSearchExpression("x".repeat(10_000))?.length, 34);
});

test("schema 1 upgrades by rebuilding candidates from existing private note rows", async (t) => {
  const path = fixture(t);
  const db = connection(path);
  db.raw.exec(`CREATE TABLE notes (
    libraryID INTEGER NOT NULL, noteKey TEXT NOT NULL, filename TEXT NOT NULL,
    title TEXT NOT NULL, groupID INTEGER, path TEXT, modified REAL, size INTEGER,
    content TEXT NOT NULL, PRIMARY KEY (libraryID, noteKey));
    CREATE TABLE links (libraryID INTEGER NOT NULL, noteKey TEXT NOT NULL,
    position INTEGER NOT NULL, endPosition INTEGER NOT NULL, href TEXT NOT NULL,
    label TEXT NOT NULL, syntax TEXT NOT NULL,
    PRIMARY KEY (libraryID, noteKey, position, endPosition));
    PRAGMA user_version=1;
    INSERT INTO notes VALUES (1, 'OLD', 'Old.md', 'Old', NULL, NULL, NULL, NULL, 'Needle body');`);
  const index = new NoteIndex(() => db.api);
  assert.deepEqual(
    [...(await index.searchCandidateKeys(1, "needle"))!],
    ["OLD"],
  );
  assert.equal(db.raw.prepare("PRAGMA user_version").get()!.user_version, 2);
  assert.equal((await index.load(1))[0]?.content, "Needle body");
  await index.close();
});

test("hosts without trigram retain ordinary caching and rebuild all changes when FTS returns", async (t) => {
  const path = fixture(t);
  const first = new NoteIndex(() => connection(path).api);
  await first.save(note("A", "original needle"));
  await first.close();
  const unavailable = connection(path, { noFts: true });
  const second = new NoteIndex(() => unavailable.api);
  await second.save(note("A", "replacement token"));
  await second.save(note("B", "newer token"));
  assert.equal(await second.searchCandidateKeys(1, "token"), undefined);
  assert.equal((await second.load(1)).length, 2);
  assert.equal(
    unavailable.raw.prepare("SELECT dirty FROM notes_search_state").get()!
      .dirty,
    1,
  );
  await second.close();
  const third = new NoteIndex(() => connection(path).api);
  assert.deepEqual(
    new Set(await third.searchCandidateKeys(1, "token")),
    new Set(["A", "B"]),
  );
  assert.deepEqual(await third.searchCandidateKeys(1, "needle"), new Set());
  await third.close();
});

test("deletion, unreadable files and superseded transactions never leave stale candidates", async () => {
  const db = connection();
  const index = new NoteIndex(() => db.api);
  await index.replace(
    1,
    [note("A", "first needle"), note("B", "second needle")],
    () => true,
  );
  await index.replace(1, [note("A", "first needle")], () => true);
  assert.deepEqual(
    await index.searchCandidateKeys(1, "needle"),
    new Set(["A"]),
  );
  const query = db.api.queryAsync;
  let current = true;
  db.api.queryAsync = async (sql: string, params: any[]) => {
    const result = await query(sql, params);
    if (sql.startsWith("INSERT INTO notes_search")) current = false;
    return result;
  };
  assert.equal(
    await index.replace(1, [note("A", "stale content")], () => current),
    false,
  );
  assert.deepEqual(
    await index.searchCandidateKeys(1, "needle"),
    new Set(["A"]),
  );
  assert.deepEqual(await index.searchCandidateKeys(1, "stale"), new Set());
  db.api.queryAsync = query;
  await index.save(note("A", "first needle", { readError: "missing" }));
  assert.deepEqual(await index.searchCandidateKeys(1, "needle"), new Set());
  await index.close();
});

test("an FTS write failure rolls back body and candidate updates and disables narrowing safely", async () => {
  const options = { failWrite: false };
  const db = connection(":memory:", options);
  const index = new NoteIndex(() => db.api);
  await index.save(note("A", "original needle"));
  options.failWrite = true;
  assert.equal(await index.save(note("A", "replacement token")), false);
  assert.equal(await index.searchCandidateKeys(1, "token"), undefined);
  assert.equal(
    db.raw.prepare("SELECT content FROM notes").get()!.content,
    "original needle",
  );
  assert.equal(
    db.raw
      .prepare(
        "SELECT noteKey FROM notes_search WHERE notes_search MATCH 'needle'",
      )
      .get()!.noteKey,
    "A",
  );
  await index.close();
});

test("forced rebuild repairs candidate rows and a missing FTS table rebuilds on next open", async (t) => {
  const path = fixture(t);
  const db = connection(path);
  const index = new NoteIndex(() => db.api);
  const source = note("A", "needle");
  await index.save(source);
  db.raw.exec("DELETE FROM notes_search");
  await index.replace(1, [source], () => true, true);
  assert.deepEqual(
    await index.searchCandidateKeys(1, "needle"),
    new Set(["A"]),
  );
  db.raw.exec("DROP TABLE notes_search");
  await index.close();
  const reopened = new NoteIndex(() => connection(path).api);
  assert.deepEqual(
    await reopened.searchCandidateKeys(1, "needle"),
    new Set(["A"]),
  );
  await reopened.close();
});

test("cooperative search cancels between batches and caps rendered matches while counting all", async () => {
  const notes = Array.from({ length: 250 }, (_, index) =>
    note(String(index), "😀 Needle"),
  );
  let cancelled = false;
  let progress = 0;
  const timer = setTimeout(() => {
    cancelled = true;
  }, 0);
  const interrupted = await searchNotesAsync(notes, "needle", {
    isCancelled: () => cancelled,
    onProgress: () => {
      progress += 1;
    },
  });
  clearTimeout(timer);
  assert.equal(interrupted.cancelled, true);
  assert.ok(interrupted.total < notes.length);
  assert.ok(progress > 0);
  const complete = await searchNotesAsync(notes, "needle", { limit: 12 });
  assert.equal(complete.total, notes.length);
  assert.equal(complete.matches.length, 12);
  assert.equal(complete.matches[0]?.position, 3);
  assert.equal(complete.cancelled, false);
});

test("warm library searches avoid rescanning files and stale dialog queries cannot replace newer results", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "scholar-search-library-"));
  const previous = new Map(
    ["Zotero", "IOUtils", "PathUtils"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const window = new Window({ url: "https://example.test" });
  const files = new Map<string, string>();
  let enumerations = 0;
  let reads = 0;
  let db: ReturnType<typeof connection>;
  const items = Array.from({ length: 120 }, (_, index) => {
    const path = `/note-${index}.md`;
    files.set(
      path,
      index === 42 ? "😀 specificNeedle raw" : `ordinary body ${index}`,
    );
    return {
      id: index + 1,
      key: `NOTE${String(index).padStart(4, "0")}`,
      libraryID: 1,
      attachmentFilename: `document-${index}.md`,
      attachmentContentType: "text/markdown",
      attachmentLinkMode: 0,
      isAttachment: () => true,
      getField: () => `Document ${index}`,
      getFilePathAsync: async () => path,
    };
  });
  Object.assign(globalThis, {
    PathUtils: { join },
    IOUtils: {
      makeDirectory: (path: string) => mkdir(path, { recursive: true }),
      stat: async (path: string) => ({
        type: "regular",
        lastModified: 1,
        size: files.get(path)?.length ?? 0,
      }),
    },
    Zotero: {
      DataDirectory: { dir: directory },
      DBConnection: function (path: string) {
        db = connection(path);
        return db.api;
      },
      Attachments: { LINK_MODE_LINKED_URL: 3 },
      Libraries: { userLibraryID: 1 },
      Items: {
        getAll: async () => {
          enumerations += 1;
          return items;
        },
      },
      File: {
        getContentsAsync: async (path: string) => {
          reads += 1;
          return files.get(path);
        },
      },
    },
  });
  t.after(async () => {
    window.close();
    clearNoteLibraries();
    await closeNoteIndex();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(
    (await readLibrarySearchCandidates(1, "specificNeedle"))[0]?.key,
    items[42]!.key,
  );
  assert.equal(reads, 120);
  assert.equal(enumerations, 1);
  db!.queries.length = 0;
  assert.equal((await readLibrarySearchCandidates(1, "ordinary")).length, 119);
  assert.equal(reads, 120);
  assert.equal(enumerations, 1);
  assert.equal(db!.queries.filter((sql) => sql.includes("MATCH ?")).length, 1);
  assert.equal(
    db!.queries.some((sql) => sql.startsWith("SELECT * FROM notes")),
    false,
  );
  files.set("/note-0.md", "ordinary updated");
  updateIndexedNote(items[0] as unknown as Zotero.Item, "ordinary updated");
  assert.equal(
    (await readLibrarySearchCandidates(1, "ordinary"))[0]?.key,
    items[0]!.key,
  );
  files.set("/note-42.md", "replacementNeedle");
  updateIndexedNote(items[42] as unknown as Zotero.Item, "replacementNeedle");
  assert.equal(
    (await readLibrarySearchCandidates(1, "replacementNeedle")).length,
    1,
  );
  assert.equal(
    (await readLibrarySearchCandidates(1, "specificNeedle")).length,
    0,
  );
  assert.equal(reads, 120);

  const originalQuery = db!.api.queryAsync;
  files.set("/note-19.md", "newlyIndexedRare phrase");
  invalidateNoteLibrary(1);
  let overtaken = false;
  db!.api.queryAsync = async (sql: string, params: any[] = []) => {
    const result = await originalQuery(sql, params);
    if (
      !overtaken &&
      sql.startsWith("INSERT OR REPLACE INTO notes") &&
      params[1] === items[19]!.key
    ) {
      overtaken = true;
      files.set("/note-42.md", "replacementNeedle concurrent");
      updateIndexedNote(
        items[42] as unknown as Zotero.Item,
        "replacementNeedle concurrent",
      );
    }
    return result;
  };
  assert.equal(
    (await readLibrarySearchCandidates(1, "newlyIndexedRare"))[0]?.key,
    items[19]!.key,
  );
  assert.equal(overtaken, true);
  assert.equal(
    (await readLibrarySearchCandidates(1, "concurrent"))[0]?.key,
    items[42]!.key,
  );
  let release!: () => void;
  let began!: () => void;
  const waiting = new Promise<void>((resolve) => {
    began = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  db!.api.queryAsync = async (sql: string, params: any[] = []) => {
    if (sql.includes("MATCH ?") && params[0] === '"ordinary"') {
      began();
      await blocked;
    }
    return originalQuery(sql, params);
  };
  await showNoteSearch(
    window as unknown as Window,
    items[0] as unknown as Zotero.Item,
  );
  const input = window.document.querySelector("input")!;
  input.value = "ordinary";
  input.dispatchEvent(new window.Event("input"));
  await waiting;
  input.value = "replacementNeedle";
  input.dispatchEvent(new window.Event("input"));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(window.document.querySelectorAll("dialog strong").length, 0);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(
    [...window.document.querySelectorAll("dialog strong")].map(
      (heading) => heading.textContent,
    ),
    ["Document 42"],
  );
  window.document.querySelector("dialog")!.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector("dialog"), null);
  await t.test(
    "shutdown cancels a pending MATCH without reopening the library cache",
    async () => {
      const readsBefore = reads;
      const enumerationsBefore = enumerations;
      let queryStarted!: () => void;
      let releaseQuery!: () => void;
      const started = new Promise<void>((resolve) => {
        queryStarted = resolve;
      });
      const blockedQuery = new Promise<void>((resolve) => {
        releaseQuery = resolve;
      });
      db!.api.queryAsync = async (sql: string, params: any[] = []) => {
        if (sql.includes("MATCH ?")) {
          queryStarted();
          await blockedQuery;
        }
        return originalQuery(sql, params);
      };
      const searching = readLibrarySearchCandidates(1, "ordinary");
      await started;
      clearNoteLibraries();
      const closing = closeNoteIndex();
      releaseQuery();
      assert.deepEqual(await searching, []);
      await closing;
      assert.equal(reads, readsBefore);
      assert.equal(enumerations, enumerationsBefore);
    },
  );
});
