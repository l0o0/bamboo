import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

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
    this.api = { version: 1 };
  }
}

export default Addon;
