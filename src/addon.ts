import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { getString } from "./utils/locale";
import type { MarkdownApi } from "./modules/markdown/api";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
  };
  public hooks: typeof hooks;
  public api: {
    version: number;
    openMarkdown?: typeof import("./modules/markdown").openMarkdownAttachment;
    createMarkdown?: typeof import("./modules/markdown").createMarkdownAttachment;
    /** Populated on startup (see hooks.ts). */
    markdown?: MarkdownApi;
    /** Public localization helper for runtime/manual integration checks. */
    getString: typeof getString;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = { version: 1, getString };
  }
}

export default Addon;
