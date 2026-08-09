import {
  flushAllSessions,
  injectMarkdownStyles,
  registerFileOpenInterceptor,
  registerMarkdownTabHooks,
  registerMenus,
  unregisterFileOpenInterceptor,
} from "./modules/markdown";
import { ensureDOMGlobals } from "./utils/dom";
import { getString, initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefs();
  registerFileOpenInterceptor();
  registerMenus();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
  ztoolkit.log(`${addon.data.config.addonName} initialized`);
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  // Plugin sandbox has no browser `document`; bridge from chrome window
  // so CodeMirror / DOM libraries work (also via ztoolkit.getGlobal).
  ensureDOMGlobals(win);

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  registerMarkdownTabHooks(win);
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
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  await flushAllSessions();
  unregisterFileOpenInterceptor();
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
