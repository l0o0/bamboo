import {
  createMarkdownModalController,
  applySettings,
  type SettingsModalData,
} from "./modal";
import { injectMarkdownStyles } from "./styles";

let activeSettingsDestroy: (() => void) | null = null;

export function markdownSettingsAbout() {
  return {
    name: addon.data.config.addonName,
    version: __buildVersion__,
    buildTime: __buildTime__,
  };
}

export async function saveMarkdownSettings(
  settings: SettingsModalData,
): Promise<void> {
  applySettings(settings);
  const { registerShortcuts } = await import("./menu");
  registerShortcuts();
}

export function openMarkdownSettings(win?: _ZoteroTypes.MainWindow): void {
  const target =
    win ||
    (Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined) ||
    Zotero.getMainWindows().find((candidate) => !candidate.closed);
  if (!target) return;

  activeSettingsDestroy?.();
  injectMarkdownStyles(target);
  const host = target.document.createElement("div");
  host.className = "zotero-markdown-root zotero-markdown-settings-host";
  host.classList.toggle(
    "theme-dark",
    !!target.matchMedia?.("(prefers-color-scheme: dark)")?.matches,
  );
  target.document.documentElement.appendChild(host);

  const destroy = () => {
    controller?.destroy();
    host.remove();
    if (activeSettingsDestroy === destroy) activeSettingsDestroy = null;
  };
  const controller = createMarkdownModalController(
    target.document,
    {
      async onSettings(settings) {
        await saveMarkdownSettings(settings);
      },
      onClose() {
        target.setTimeout(destroy, 0);
      },
    },
    { mount: host, about: markdownSettingsAbout() },
  );
  activeSettingsDestroy = destroy;
  controller.open("settings");
}

export function bindMarkdownSettingsPreferencePane(doc: Document): () => void {
  const entry = doc.getElementById("zotero-markdown-open-settings");
  if (!entry || entry.getAttribute("data-zmd-bound") === "true")
    return () => {};
  const onOpen = () => openMarkdownSettings();
  entry.setAttribute("data-zmd-bound", "true");
  entry.addEventListener("click", onOpen);
  return () => {
    entry.removeEventListener("click", onOpen);
    entry.removeAttribute("data-zmd-bound");
  };
}
