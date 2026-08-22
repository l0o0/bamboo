declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

/** Firefox / Zotero PathUtils (IOUtils companion). */
declare namespace PathUtils {
  function join(...components: string[]): string;
  function parent(path: string, depth?: number): string | null;
}

declare const PathUtils: typeof PathUtils;

declare namespace IOUtils {
  function exists(path: string): Promise<boolean>;
  function remove(path: string): Promise<void>;
  function makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean; permissions?: number },
  ): Promise<void>;
  function read(path: string): Promise<Uint8Array>;
  function write(path: string, data: Uint8Array): Promise<number>;
  function getChildren(path: string): Promise<string[]>;
  function stat(
    path: string,
  ): Promise<{ type?: "directory" | "other" | "regular"; size?: number }>;
}

declare const IOUtils: typeof IOUtils;
