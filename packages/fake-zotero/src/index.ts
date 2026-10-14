export type FakePrefs = Record<string, string | number | boolean>;

export interface FakeCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
  creatorType?: string;
}

export interface FakeTag {
  tag: string;
  type?: number;
}

export interface FakeItemData {
  id: number;
  key: string;
  libraryID?: number;
  itemType: string;
  parentID?: number;
  fields?: Record<string, string>;
  creators?: FakeCreator[];
  tags?: FakeTag[];
  note?: string;
  attachmentContentType?: string;
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationPosition?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
}

export interface FakeLibraryData {
  libraryID: number;
  libraryType: "user" | "group";
  groupID?: number;
  name?: string;
}

export interface FakeZoteroOptions {
  items?: FakeItemData[];
  libraries?: FakeLibraryData[];
  prefs?: FakePrefs;
  userID?: number;
  username?: string;
}

export interface FakeCall {
  method: string;
  args: unknown[];
}

export type FakeLibrary = FakeLibraryData;

export interface FakeItem {
  readonly id: number;
  readonly itemID: number;
  readonly key: string;
  readonly libraryID: number;
  readonly itemType: string;
  readonly parentID?: number;
  readonly parentItemID?: number;
  readonly parentItem: FakeItem | null;
  note?: string;
  attachmentContentType?: string;
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationPosition?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  getField(field: string): string;
  setField(field: string, value: string): void;
  getCreators(): FakeCreator[];
  getTags(): FakeTag[];
  getAttachments(): number[];
  getAnnotations(): FakeItem[];
  getNotes(): number[];
  getNote(): string;
  getNoteTitle(): string;
  setNote(note: string): void;
  saveTx(): Promise<void>;
  isRegularItem(): boolean;
  isNote(): boolean;
  isAttachment(): boolean;
  isAnnotation(): boolean;
}

export interface FakeSearch {
  libraryID: number;
  addCondition(field: string, operator: string, value: string): number;
  search(): Promise<number[]>;
}

export interface FakeZotero {
  readonly __fakeZotero: true;
  readonly initializationPromise: Promise<void>;
  readonly unlockPromise: Promise<void>;
  readonly uiReadyPromise: Promise<void>;
  readonly Prefs: {
    get(key: string, global?: boolean): string | number | boolean | undefined;
    set(key: string, value: string | number | boolean, global?: boolean): void;
    clear(key: string, global?: boolean): void;
  };
  readonly Users: {
    getCurrentUserID(): number;
    getCurrentUsername(): string;
  };
  readonly Libraries: {
    userLibraryID: number;
    get(libraryID: number): FakeLibrary | false;
  };
  readonly Groups: {
    get(groupID: number): FakeLibrary | false;
  };
  readonly Search: new (options?: { libraryID?: number }) => FakeSearch;
  readonly Items: {
    get(itemID: number): FakeItem | false;
    get(itemID: number[]): (FakeItem | false)[];
    getAsync(itemID: number): Promise<FakeItem | false>;
    getAsync(itemID: number[]): Promise<(FakeItem | false)[]>;
    getByLibraryAndKey(libraryID: number, key: string): FakeItem | false;
    getAll(libraryID?: number): Promise<FakeItem[]>;
  };
  readonly Reader: {
    open(itemID: number, location?: unknown): void;
  };
  readonly FileHandlers: {
    open(item: FakeItem | number, options?: unknown): void;
  };
  readonly Utilities: {
    cleanTags(html: string): string;
    unescapeHTML(html: string): string;
  };
  getMainWindow(): {
    ZoteroPane: {
      getSelectedItems(asIDs?: boolean): FakeItem[] | number[];
      selectItem(id: number): void;
      openNote(id: number): void;
    };
  };
  log(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  logError(...args: unknown[]): void;
}

export interface FakeSnapshot {
  items: FakeItemData[];
  libraries: FakeLibraryData[];
  prefs: FakePrefs;
  selectedItemIDs: number[];
  userID: number;
  username: string;
}

export interface FakeZoteroInstance {
  Zotero: FakeZotero;
  calls: FakeCall[];
  snapshot(): FakeSnapshot;
  reset(): void;
  install(target?: object): () => void;
}

type AnyRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as T;
  if (value && typeof value === "object") {
    const result: AnyRecord = {};
    for (const [key, entry] of Object.entries(value as AnyRecord)) {
      result[key] = clone(entry);
    }
    return result as T;
  }
  return value;
}

function normalizeItem(item: FakeItemData): FakeItemData {
  return {
    ...clone(item),
    libraryID: item.libraryID ?? 1,
    fields: clone(item.fields ?? {}),
    creators: clone(item.creators ?? []),
    tags: clone(item.tags ?? []),
  };
}

function preferenceKey(key: string, global: boolean): string {
  return global ? key : `extensions.zotero.${key}`;
}

export function createFakeZotero(
  options: FakeZoteroOptions = {},
): FakeZoteroInstance {
  const seedItems = (options.items ?? []).map(normalizeItem);
  const configuredLibraries = clone(options.libraries ?? []);
  const seedLibraries = configuredLibraries.some(
    (library) => library.libraryType === "user",
  )
    ? configuredLibraries
    : [{ libraryID: 1, libraryType: "user" as const }, ...configuredLibraries];
  const seedPrefs = clone(options.prefs ?? {});
  const seedUserID = options.userID ?? 1;
  const seedUsername = options.username ?? "Fake Zotero User";
  const calls: FakeCall[] = [];
  let itemsData: FakeItemData[] = [];
  let librariesData: FakeLibraryData[] = [];
  let prefs: FakePrefs = {};
  let selectedItemIDs: number[] = [];
  let itemRegistry = new Map<number, FakeItem>();

  const validateSeed = () => {
    const libraryIDs = new Set<number>();
    for (const library of seedLibraries) {
      if (libraryIDs.has(library.libraryID)) {
        throw new Error(`Duplicate fake Zotero library ${library.libraryID}`);
      }
      libraryIDs.add(library.libraryID);
    }
    const itemIDs = new Set<number>();
    const keys = new Set<string>();
    for (const item of seedItems) {
      if (itemIDs.has(item.id))
        throw new Error(`Duplicate fake Zotero item ${item.id}`);
      itemIDs.add(item.id);
      const key = `${item.libraryID ?? 1}:${item.key}`;
      if (keys.has(key)) throw new Error(`Duplicate fake Zotero key ${key}`);
      keys.add(key);
    }
    for (const item of seedItems) {
      if (item.parentID == null) continue;
      const parent = seedItems.find(
        (candidate) => candidate.id === item.parentID,
      );
      if (!parent) throw new Error(`Unknown parent item ${item.parentID}`);
      if ((parent.libraryID ?? 1) !== (item.libraryID ?? 1)) {
        throw new Error(
          `Fake Zotero parent ${item.parentID} is in another library`,
        );
      }
    }
  };
  validateSeed();

  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };

  const itemForID = (id: number): FakeItem | false =>
    itemRegistry.get(id) ?? false;
  const requireItem = (input: unknown): FakeItem => {
    const id =
      typeof input === "number" ? input : (input as { id?: unknown })?.id;
    const item = typeof id === "number" ? itemForID(id) : false;
    if (!item) throw new Error(`Fake Zotero item ${String(id)} does not exist`);
    return item;
  };

  const makeItem = (data: FakeItemData): FakeItem => {
    const item = {
      get id() {
        return data.id;
      },
      get itemID() {
        return data.id;
      },
      get key() {
        return data.key;
      },
      get libraryID() {
        return data.libraryID ?? 1;
      },
      get itemType() {
        return data.itemType;
      },
      get parentID() {
        return data.parentID;
      },
      get parentItemID() {
        return data.parentID;
      },
      get parentItem() {
        return data.parentID == null
          ? null
          : (itemRegistry.get(data.parentID) ?? null);
      },
      get note() {
        return data.note;
      },
      set note(value: string | undefined) {
        data.note = value;
      },
      get attachmentContentType() {
        return data.attachmentContentType;
      },
      set attachmentContentType(value: string | undefined) {
        data.attachmentContentType = value;
      },
      get annotationType() {
        return data.annotationType;
      },
      set annotationType(value: string | undefined) {
        data.annotationType = value;
      },
      get annotationText() {
        return data.annotationText;
      },
      set annotationText(value: string | undefined) {
        data.annotationText = value;
      },
      get annotationComment() {
        return data.annotationComment;
      },
      set annotationComment(value: string | undefined) {
        data.annotationComment = value;
      },
      get annotationPosition() {
        return data.annotationPosition;
      },
      set annotationPosition(value: string | undefined) {
        data.annotationPosition = value;
      },
      get annotationColor() {
        return data.annotationColor;
      },
      set annotationColor(value: string | undefined) {
        data.annotationColor = value;
      },
      get annotationPageLabel() {
        return data.annotationPageLabel;
      },
      set annotationPageLabel(value: string | undefined) {
        data.annotationPageLabel = value;
      },
      get annotationSortIndex() {
        return data.annotationSortIndex;
      },
      set annotationSortIndex(value: string | undefined) {
        data.annotationSortIndex = value;
      },
      getField(field: string) {
        if (field === "title" && data.itemType === "note")
          return item.getNoteTitle();
        return field === "note"
          ? (data.note ?? "")
          : (data.fields?.[field] ?? "");
      },
      setField(field: string, value: string) {
        if (field === "note") data.note = value;
        else (data.fields ??= {})[field] = value;
      },
      getCreators() {
        return clone(data.creators ?? []);
      },
      getTags() {
        return clone(data.tags ?? []);
      },
      getAttachments() {
        return itemsData
          .filter(
            (child) =>
              child.parentID === data.id && child.itemType === "attachment",
          )
          .map((child) => child.id);
      },
      getAnnotations() {
        return itemsData
          .filter(
            (child) =>
              child.parentID === data.id && child.itemType === "annotation",
          )
          .map((child) => itemRegistry.get(child.id)!)
          .filter(Boolean);
      },
      getNotes() {
        return itemsData
          .filter(
            (child) => child.parentID === data.id && child.itemType === "note",
          )
          .map((child) => child.id);
      },
      getNote() {
        return data.note ?? "";
      },
      getNoteTitle() {
        const title = data.fields?.title;
        if (title) return title;
        const text = (data.note ?? "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p\s*>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .trim();
        return text.split(/\r?\n/)[0] ?? "";
      },
      setNote(note: string) {
        data.note = note;
      },
      saveTx() {
        record("item.saveTx", data.id);
        return Promise.resolve();
      },
      isRegularItem() {
        return !["note", "attachment", "annotation"].includes(data.itemType);
      },
      isNote() {
        return data.itemType === "note";
      },
      isAttachment() {
        return data.itemType === "attachment";
      },
      isAnnotation() {
        return data.itemType === "annotation";
      },
    } as FakeItem;
    return item;
  };

  const rebuildItems = () => {
    itemRegistry = new Map(itemsData.map((data) => [data.id, makeItem(data)]));
  };

  function itemGet(itemID: number): FakeItem | false;
  function itemGet(itemID: number[]): (FakeItem | false)[];
  function itemGet(
    itemID: number | number[],
  ): FakeItem | false | (FakeItem | false)[] {
    return Array.isArray(itemID) ? itemID.map(itemForID) : itemForID(itemID);
  }

  async function itemGetAsync(itemID: number): Promise<FakeItem | false>;
  async function itemGetAsync(itemID: number[]): Promise<(FakeItem | false)[]>;
  async function itemGetAsync(
    itemID: number | number[],
  ): Promise<FakeItem | false | (FakeItem | false)[]> {
    return Array.isArray(itemID) ? itemID.map(itemForID) : itemForID(itemID);
  }

  async function itemGetAll(libraryID?: number): Promise<FakeItem[]> {
    if (
      arguments.length > 1 ||
      (libraryID !== undefined && typeof libraryID !== "number")
    ) {
      throw new TypeError("Fake Zotero Items.getAll accepts only libraryID");
    }
    return itemsData
      .filter((item) => libraryID == null || item.libraryID === libraryID)
      .map((item) => itemRegistry.get(item.id)!)
      .filter((item): item is FakeItem => Boolean(item));
  }

  const userLibraryID = () =>
    librariesData.find((library) => library.libraryType === "user")
      ?.libraryID ?? 1;
  class MetadataSearch implements FakeSearch {
    libraryID: number;
    private conditions: Array<[string, string, string]> = [];
    constructor(options: { libraryID?: number } = {}) {
      this.libraryID = options.libraryID ?? userLibraryID();
    }
    addCondition(field: string, operator: string, value: string): number {
      if (!(
        (field === "title" && (operator === "is" || operator === "contains")) ||
        (field === "itemType" && operator === "is")
      )) {
        throw new Error(
          `Fake Zotero Search does not support ${field} ${operator}`,
        );
      }
      this.conditions.push([field, operator, value]);
      return this.conditions.length - 1;
    }
    async search(): Promise<number[]> {
      return itemsData
        .filter(
          (data) =>
            data.libraryID === this.libraryID &&
            this.conditions.every(([field, operator, value]) => {
              if (field === "itemType") return data.itemType === value;
              // Native Zotero indexes note titles in itemNotes, not the itemData
              // title field. Callers must query notes separately to include them.
              if (data.itemType === "note") return false;
              const title = (data.fields?.title ?? "").toLocaleLowerCase();
              const needle = value.toLocaleLowerCase();
              return operator === "is"
                ? title === needle
                : title.includes(needle);
            }),
        )
        .map((data) => data.id);
    }
  }

  const getMainWindow = () => ({
    ZoteroPane: {
      getSelectedItems(asIDs = false) {
        record("ZoteroPane.getSelectedItems", asIDs);
        return asIDs
          ? [...selectedItemIDs]
          : selectedItemIDs
              .map((id) => itemRegistry.get(id))
              .filter((item): item is FakeItem => Boolean(item));
      },
      selectItem(id: number) {
        requireItem(id);
        selectedItemIDs = [id];
        record("ZoteroPane.selectItem", id);
      },
      openNote(id: number) {
        requireItem(id);
        record("ZoteroPane.openNote", id);
      },
    },
  });

  const Zotero: FakeZotero = {
    __fakeZotero: true,
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: Promise.resolve(),
    Prefs: {
      get(key, global = false) {
        return prefs[preferenceKey(key, global)];
      },
      set(key, value, global = false) {
        const normalized = preferenceKey(key, global);
        prefs[normalized] = value;
        record("Prefs.set", normalized, value, global);
      },
      clear(key, global = false) {
        const normalized = preferenceKey(key, global);
        delete prefs[normalized];
        record("Prefs.clear", normalized, global);
      },
    },
    Users: {
      getCurrentUserID: () => seedUserID,
      getCurrentUsername: () => seedUsername,
    },
    Libraries: {
      get userLibraryID() {
        return userLibraryID();
      },
      get(libraryID) {
        return clone(
          librariesData.find((library) => library.libraryID === libraryID) ??
            false,
        );
      },
    },
    Groups: {
      get(groupID) {
        return clone(
          librariesData.find((library) => library.groupID === groupID) ?? false,
        );
      },
    },
    Search: MetadataSearch,
    Items: {
      get: itemGet,
      getAsync: itemGetAsync,
      getByLibraryAndKey(libraryID, key) {
        return (
          itemsData
            .filter((item) => item.libraryID === libraryID && item.key === key)
            .map((item) => itemRegistry.get(item.id))[0] ?? false
        );
      },
      getAll: itemGetAll,
    },
    Reader: {
      open(itemID, location) {
        requireItem(itemID);
        record(
          "Reader.open",
          itemID,
          ...(arguments.length > 1 ? [location] : []),
        );
      },
    },
    FileHandlers: {
      open(item, options) {
        requireItem(item);
        record(
          "FileHandlers.open",
          item,
          ...(arguments.length > 1 ? [options] : []),
        );
      },
    },
    Utilities: {
      cleanTags: (html) =>
        html
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p\s*>/gi, "\n")
          .replace(/<[^>]*>/g, "")
          .trim(),
      unescapeHTML: (html) =>
        html.replace(
          /&(amp|lt|gt|quot|#39|nbsp);/g,
          (_, entity: string) =>
            ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[
              entity
            ] ?? _,
        ),
    },
    getMainWindow,
    log: (...args) => record("log", ...args),
    debug: (...args) => record("debug", ...args),
    logError: (...args) => record("logError", ...args),
  };

  const reset = () => {
    itemsData = clone(seedItems);
    librariesData = clone(seedLibraries);
    prefs = clone(seedPrefs);
    selectedItemIDs = [];
    rebuildItems();
    calls.length = 0;
  };

  reset();

  return {
    Zotero,
    calls,
    snapshot() {
      return {
        items: clone(itemsData),
        libraries: clone(librariesData),
        prefs: clone(prefs),
        selectedItemIDs: [...selectedItemIDs],
        userID: seedUserID,
        username: seedUsername,
      };
    },
    reset,
    install(target = globalThis) {
      const targetRecord = target as Record<string, unknown>;
      if ("Zotero" in targetRecord)
        throw new Error("Refusing to overwrite existing Zotero");
      targetRecord.Zotero = Zotero;
      return () => {
        if (targetRecord.Zotero === Zotero) delete targetRecord.Zotero;
      };
    },
  };
}
