import {
  createMarkdownAttachment,
  flushAllSessions,
  flushSessionsForWindow,
  injectMarkdownStyles,
  openMarkdownAttachment,
  registerFileOpenInterceptor,
  registerMarkdownTabHooks,
  registerMenus,
  registerItemContextMenu,
  registerShortcuts,
  unregisterFileOpenInterceptor,
  unregisterMenus,
  unregisterItemContextMenu,
  unregisterShortcuts,
} from "./modules/markdown";
import { ensureDOMGlobals } from "./utils/dom";
import { getString, initLocale } from "./utils/locale";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefs();
  registerFileOpenInterceptor();
  // Register global toolbar menus first. registerMenus() performs a global
  // cleanup, so per-window item context menus must be mounted afterwards.
  registerMenus();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.api = {
    version: 1,
    openMarkdown: openMarkdownAttachment,
    createMarkdown: createMarkdownAttachment,
  };
  addon.data.initialized = true;
  ztoolkit.log(`${addon.data.config.addonName} initialized`);
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Plugin sandbox has no browser `document`; bridge from chrome window
  // so DOM libraries work (also via ztoolkit.getGlobal).
  ensureDOMGlobals(win);

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Idempotent: KeyboardManager listens on all windows (via Services.wm),
  // so shortcuts must be registered only once per ztoolkit instance.
  registerShortcuts();

  registerMarkdownTabHooks(win);
  registerItemContextMenu(win);
  injectMarkdownStyles(win);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({
      text: getString("startup-finish"),
      type: "success",
      progress: 100,
    })
    .show();
  popupWin.startCloseTimer(3000);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // Do NOT call ztoolkit.unregisterAll() here: it is a global teardown that
  // removes listeners from ALL windows (e.g. KeyboardManager removes every
  // window's keydown listeners), breaking shortcuts in other windows.
  // Per-window cleanup is handled by the toolkit's own Services.wm
  // onCloseWindow callbacks (unInitKeyboardListener for the closing window).
  await flushSessionsForWindow(_win);
  unregisterItemContextMenu(_win);
}

async function onShutdown(): Promise<void> {
  await flushAllSessions();
  unregisterFileOpenInterceptor();
  unregisterMenus();
  unregisterShortcuts();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      // Prefs pane is preference-bound; nothing extra for MVP
      void data;
      break;
    default:
      break;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
