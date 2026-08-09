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
}

declare const PathUtils: typeof PathUtils;

declare namespace IOUtils {
  function exists(path: string): Promise<boolean>;
  function remove(path: string): Promise<void>;
}

declare const IOUtils: typeof IOUtils;
