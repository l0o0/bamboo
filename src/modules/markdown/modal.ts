import { getPref, setPref } from "../../utils/prefs";
import {
  DEFAULT_NEW_MARKDOWN_SHORTCUT,
  shortcutFromKeyboardEvent,
  shortcutKeycaps,
} from "./shortcut";
import { getString } from "../../utils/locale";
import {
  iconInfo,
  iconKeyboard,
  iconMoreHorizontal,
  iconSettings,
  iconType,
} from "./icons";
import {
  nextSettingsPage,
  SETTINGS_PAGES,
  settingsPageLabel,
  type SettingsPageID,
} from "./settings-pages";
import { normalizeMarkdownFilename } from "./storage-filename";

export { normalizeMarkdownFilename } from "./storage-filename";

export type ModalKind = "document-info" | "rename" | "settings";

export interface DocumentModalData {
  title: string;
  path: string | null;
  size: number | null;
  imageCount: number;
  created: string | null;
  modified: string | null;
  storageLabel: string;
}

export interface SettingsModalData {
  enable: boolean;
  frontmatter: boolean;
  fontSize: number;
  shortcutNewStandaloneMd: string;
}

export interface MarkdownModalCallbacks {
  onRename?: (filename: string) => Promise<void> | void;
  onReveal?: () => Promise<void> | void;
  onSettings?: (settings: SettingsModalData) => Promise<void> | void;
  onClose?: () => void;
}

export interface MarkdownModalOptions {
  mount?: HTMLElement;
  about?: {
    name: string;
    version: string;
    buildTime: string;
  };
}

export interface MarkdownModalController {
  open: (
    kind: ModalKind,
    payload?: DocumentModalData | Partial<SettingsModalData>,
  ) => void;
  close: () => void;
  destroy: () => void;
}

export function modalTitle(kind: ModalKind): string {
  switch (kind) {
    case "document-info":
      return getString("more-document-info");
    case "rename":
      return getString("more-rename");
    case "settings":
      return getString("more-settings");
  }
}

export function formatModalBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "")} GB`;
}

export function formatModalDate(
  value: string | number | Date | null,
  locale?: string,
): string {
  if (value === null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale);
}

export function settingsFromPrefs(
  prefs: SettingsModalData = {
    enable: Boolean(getPref("enable")),
    frontmatter: Boolean(getPref("frontmatter")),
    fontSize: Number(getPref("fontSize")) || 14,
    shortcutNewStandaloneMd: String(getPref("shortcutNewStandaloneMd") || ""),
  },
): SettingsModalData {
  return {
    enable: Boolean(prefs.enable),
    frontmatter: Boolean(prefs.frontmatter),
    fontSize: Number(prefs.fontSize) || 14,
    shortcutNewStandaloneMd: String(prefs.shortcutNewStandaloneMd || ""),
  };
}

export function prefsFromSettings(settings: SettingsModalData) {
  return settingsFromPrefs(settings);
}

function textElement(
  doc: Document,
  tag: string,
  text: string,
  className?: string,
) {
  const element = doc.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(doc: Document, label: string, action: string, primary = false) {
  const element = doc.createElement("button");
  element.type = "button";
  element.dataset.modalAction = action;
  element.className = `zotero-markdown-modal-button${primary ? " is-primary" : ""}`;
  element.textContent = label;
  return element;
}

export function createMarkdownModalController(
  doc: Document,
  callbacks: MarkdownModalCallbacks = {},
  options: MarkdownModalOptions = {},
): MarkdownModalController {
  const backdrop = doc.createElement("div");
  backdrop.className = "zotero-markdown-modal-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");

  const dialog = doc.createElement("section");
  dialog.className = "zotero-markdown-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const title = textElement(doc, "h2", "", "zotero-markdown-modal-title");
  const close = button(doc, "×", "close");
  close.classList.add("is-close");
  close.setAttribute("aria-label", getString("modal-close"));
  const header = doc.createElement("header");
  header.className = "zotero-markdown-modal-header";
  header.append(title, close);
  const body = doc.createElement("div");
  body.className = "zotero-markdown-modal-body";
  dialog.append(header, body);
  backdrop.appendChild(dialog);
  const mount = options.mount || doc.body || doc.documentElement;
  if (!mount) {
    throw new Error("Markdown modal mount is not available");
  }
  mount.appendChild(backdrop);

  let activeKind: ModalKind | null = null;
  let restoreFocus: HTMLElement | null = null;
  let pendingSettings: SettingsModalData | null = null;

  const closeModal = () => {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    activeKind = null;
    restoreFocus?.focus?.();
    restoreFocus = null;
    callbacks.onClose?.();
  };

  const renderDocumentInfo = (data: DocumentModalData) => {
    const rows: [string, string][] = [
      [getString("modal-filename"), data.title || "—"],
      [getString("modal-path"), data.path || "—"],
      [getString("modal-size"), formatModalBytes(data.size)],
      [getString("modal-image-count"), String(data.imageCount)],
      [getString("modal-created"), formatModalDate(data.created)],
      [getString("modal-modified"), formatModalDate(data.modified)],
      [getString("modal-storage-type"), data.storageLabel || "—"],
    ];
    const list = doc.createElement("dl");
    list.className = "zotero-markdown-modal-info";
    for (const [label, value] of rows) {
      list.append(textElement(doc, "dt", label), textElement(doc, "dd", value));
    }
    body.appendChild(list);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(button(doc, getString("more-show-in-folder"), "reveal"));
    body.appendChild(footer);
  };

  const renderRename = (data: DocumentModalData) => {
    const label = textElement(
      doc,
      "label",
      getString("modal-filename"),
      "zotero-markdown-modal-label",
    );
    const input = doc.createElement("input");
    input.type = "text";
    input.name = "filename";
    input.value = data.title || "Note.md";
    input.className = "zotero-markdown-modal-input";
    label.appendChild(input);
    body.appendChild(label);
    const error = textElement(doc, "p", "", "zotero-markdown-modal-error");
    error.hidden = true;
    body.appendChild(error);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(
      button(doc, getString("modal-cancel"), "close"),
      button(doc, getString("more-rename"), "rename", true),
    );
    body.appendChild(footer);
    input.focus();
    input.select();
  };

  const renderSettings = (payload: Partial<SettingsModalData> = {}) => {
    pendingSettings = settingsFromPrefs({
      enable: payload.enable ?? Boolean(getPref("enable")),
      frontmatter: payload.frontmatter ?? Boolean(getPref("frontmatter")),
      fontSize: payload.fontSize ?? (Number(getPref("fontSize")) || 14),
      shortcutNewStandaloneMd:
        payload.shortcutNewStandaloneMd ??
        String(getPref("shortcutNewStandaloneMd") || ""),
    });

    const workspace = doc.createElement("form");
    workspace.className = "zotero-markdown-settings-workspace";
    workspace.addEventListener("submit", (event) => event.preventDefault());
    const navigation = doc.createElement("nav");
    navigation.className = "zotero-markdown-settings-navigation";
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", getString("settings-tablist-label"));
    const main = doc.createElement("main");
    main.className = "zotero-markdown-settings-main";
    const pageContent = doc.createElement("div");
    pageContent.className = "zotero-markdown-settings-page";
    const footer = doc.createElement("footer");
    footer.className =
      "zotero-markdown-modal-footer zotero-markdown-settings-footer";
    footer.append(button(doc, getString("modal-done"), "save-settings", true));
    const error = textElement(doc, "p", "", "zotero-markdown-modal-error");
    error.hidden = true;
    main.append(pageContent, error, footer);
    workspace.append(navigation, main);

    const iconForPage = (page: SettingsPageID) => {
      if (page === "general") return iconSettings();
      if (page === "editor") return iconType();
      if (page === "shortcuts") return iconKeyboard();
      return iconInfo();
    };
    let activePage: SettingsPageID = "general";

    const renderHeading = (label: string) => {
      const heading = textElement(
        doc,
        "h3",
        label,
        "zotero-markdown-settings-page-title",
      );
      heading.tabIndex = -1;
      pageContent.appendChild(heading);
      return heading;
    };

    const renderGeneral = () => {
      const heading = renderHeading(getString("settings-page-general"));
      const checkbox = (name: "enable" | "frontmatter", labelText: string) => {
        const label = doc.createElement("label");
        label.className = "zotero-markdown-settings-check-row";
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.name = name;
        input.checked = !!pendingSettings?.[name];
        input.addEventListener("change", () => {
          if (pendingSettings) pendingSettings[name] = input.checked;
        });
        label.append(input, textElement(doc, "span", labelText));
        pageContent.appendChild(label);
      };
      checkbox("enable", getString("settings-enable-editor"));
      checkbox("frontmatter", getString("settings-frontmatter"));
      return heading;
    };

    const renderEditor = () => {
      const heading = renderHeading(getString("settings-page-editor"));
      const row = doc.createElement("label");
      row.className = "zotero-markdown-settings-row";
      row.appendChild(
        textElement(doc, "span", getString("settings-font-size")),
      );
      const size = doc.createElement("input");
      size.type = "number";
      size.name = "fontSize";
      size.min = "11";
      size.max = "22";
      size.step = "1";
      size.value = String(pendingSettings?.fontSize || 14);
      size.className = "zotero-markdown-modal-input is-small";
      size.addEventListener("change", () => {
        if (pendingSettings)
          pendingSettings.fontSize = Math.min(
            22,
            Math.max(11, Number(size.value) || 14),
          );
      });
      row.appendChild(size);
      pageContent.appendChild(row);
      return heading;
    };

    const renderShortcuts = () => {
      const heading = renderHeading(getString("settings-page-shortcuts"));
      pageContent.appendChild(
        textElement(
          doc,
          "p",
          getString("settings-shortcut-hint"),
          "zotero-markdown-settings-description",
        ),
      );
      const row = doc.createElement("div");
      row.className = "zotero-markdown-settings-shortcut-row";
      row.appendChild(
        textElement(doc, "span", getString("settings-shortcut-new-standalone")),
      );
      const controls = doc.createElement("div");
      controls.className = "zotero-markdown-settings-shortcut-controls";
      const shortcutControl = doc.createElement("button");
      shortcutControl.type = "button";
      shortcutControl.className = "zotero-markdown-modal-shortcut-control";
      shortcutControl.setAttribute(
        "aria-label",
        getString("settings-shortcut-edit-aria"),
      );
      const shortcutValue = doc.createElement("span");
      shortcutValue.className = "zotero-markdown-modal-shortcut-value";
      const renderShortcut = () => {
        shortcutValue.replaceChildren();
        const keycaps = shortcutKeycaps(
          pendingSettings?.shortcutNewStandaloneMd || "",
          doc.defaultView?.navigator?.platform,
        );
        if (!keycaps.length)
          shortcutValue.textContent = getString("settings-shortcut-unset");
        else
          for (const keycap of keycaps)
            shortcutValue.appendChild(textElement(doc, "kbd", keycap));
      };
      renderShortcut();
      shortcutControl.appendChild(shortcutValue);
      const edit = button(
        doc,
        getString("settings-shortcut-edit"),
        "shortcut-edit",
      );
      const overflow = doc.createElement("button");
      overflow.type = "button";
      overflow.className = "zotero-markdown-shortcut-overflow";
      overflow.setAttribute("aria-label", getString("settings-shortcut-more"));
      overflow.setAttribute("aria-expanded", "false");
      overflow.innerHTML = iconMoreHorizontal();
      const overflowMenu = doc.createElement("div");
      overflowMenu.className = "zotero-markdown-shortcut-overflow-menu";
      overflowMenu.hidden = true;
      const clear = button(
        doc,
        getString("settings-shortcut-clear"),
        "shortcut-clear",
      );
      const restore = button(
        doc,
        getString("settings-shortcut-restore"),
        "shortcut-restore",
      );
      overflowMenu.append(clear, restore);

      let recordingPrevious = pendingSettings?.shortcutNewStandaloneMd || "";
      const beginRecording = () => {
        recordingPrevious = pendingSettings?.shortcutNewStandaloneMd || "";
        shortcutControl.classList.add("is-recording");
        shortcutControl.setAttribute("aria-live", "polite");
        shortcutValue.textContent = getString("settings-shortcut-recording");
        shortcutControl.focus();
      };
      shortcutControl.addEventListener("click", beginRecording);
      edit.addEventListener("click", beginRecording);
      shortcutControl.addEventListener("keydown", (event) => {
        if (!shortcutControl.classList.contains("is-recording")) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (pendingSettings)
            pendingSettings.shortcutNewStandaloneMd = recordingPrevious;
        } else if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          if (pendingSettings) pendingSettings.shortcutNewStandaloneMd = "";
        } else {
          const recorded = shortcutFromKeyboardEvent(
            event,
            doc.defaultView?.navigator?.platform,
          );
          if (!recorded) return;
          event.preventDefault();
          if (pendingSettings)
            pendingSettings.shortcutNewStandaloneMd = recorded;
        }
        shortcutControl.classList.remove("is-recording");
        shortcutControl.removeAttribute("aria-live");
        renderShortcut();
      });
      overflow.addEventListener("click", () => {
        overflowMenu.hidden = !overflowMenu.hidden;
        overflow.setAttribute("aria-expanded", String(!overflowMenu.hidden));
      });
      clear.addEventListener("click", () => {
        if (pendingSettings) pendingSettings.shortcutNewStandaloneMd = "";
        overflowMenu.hidden = true;
        renderShortcut();
      });
      restore.addEventListener("click", () => {
        if (pendingSettings)
          pendingSettings.shortcutNewStandaloneMd =
            DEFAULT_NEW_MARKDOWN_SHORTCUT;
        overflowMenu.hidden = true;
        renderShortcut();
      });
      controls.append(shortcutControl, edit, overflow, overflowMenu);
      row.appendChild(controls);
      pageContent.appendChild(row);
      return heading;
    };

    const renderAbout = () => {
      const heading = renderHeading(getString("settings-page-about"));
      const about = options.about || {
        name: "Bamboo 竹子",
        version: "—",
        buildTime: "—",
      };
      const details = doc.createElement("dl");
      details.className = "zotero-markdown-settings-about";
      for (const [label, value] of [
        [getString("settings-about-name"), about.name],
        [getString("settings-about-version"), about.version],
        [getString("settings-about-build-time"), about.buildTime],
      ]) {
        details.append(
          textElement(doc, "dt", label),
          textElement(doc, "dd", value),
        );
      }
      pageContent.appendChild(details);
      return heading;
    };

    const selectPage = (page: SettingsPageID, focusHeading = false) => {
      activePage = page;
      for (const item of navigation.querySelectorAll<HTMLButtonElement>(
        "[data-settings-page]",
      )) {
        const selected = item.dataset.settingsPage === page;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
      }
      pageContent.replaceChildren();
      const heading =
        page === "general"
          ? renderGeneral()
          : page === "editor"
            ? renderEditor()
            : page === "shortcuts"
              ? renderShortcuts()
              : renderAbout();
      if (focusHeading) heading.focus();
    };

    for (const page of SETTINGS_PAGES) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "zotero-markdown-settings-nav-item";
      item.dataset.settingsPage = page.id;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", "false");
      const icon = doc.createElement("span");
      icon.className = "zotero-markdown-settings-nav-icon";
      icon.innerHTML = iconForPage(page.id);
      item.append(icon, textElement(doc, "span", settingsPageLabel(page.id)));
      item.addEventListener("click", () => selectPage(page.id, true));
      item.addEventListener("keydown", (event) => {
        const direction =
          event.key === "ArrowDown" || event.key === "ArrowRight"
            ? 1
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        const next = nextSettingsPage(activePage, direction);
        selectPage(next);
        navigation
          .querySelector<HTMLButtonElement>(`[data-settings-page="${next}"]`)
          ?.focus();
      });
      navigation.appendChild(item);
    }

    body.appendChild(workspace);
    selectPage("general");
  };

  const showActionError = (error: unknown) => {
    const element = body.querySelector<HTMLElement>(
      ".zotero-markdown-modal-error",
    );
    if (!element) return;
    element.textContent =
      error instanceof Error ? error.message : String(error);
    element.hidden = false;
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target === backdrop) return closeModal();
    const action = target
      ?.closest?.("[data-modal-action]")
      ?.getAttribute("data-modal-action");
    if (!action) return;
    if (action === "close") return closeModal();
    if (action === "reveal") {
      return void Promise.resolve(callbacks.onReveal?.()).catch(
        showActionError,
      );
    }
    if (action === "rename") {
      const input = body.querySelector<HTMLInputElement>(
        'input[name="filename"]',
      );
      const filename = normalizeMarkdownFilename(input?.value || "");
      return void Promise.resolve(callbacks.onRename?.(filename))
        .then(closeModal)
        .catch(showActionError);
    }
    if (action === "save-settings") {
      const settings = prefsFromSettings(
        pendingSettings || settingsFromPrefs(),
      );
      return void Promise.resolve(callbacks.onSettings?.(settings))
        .then(closeModal)
        .catch(showActionError);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") closeModal();
  };
  backdrop.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeyDown);

  return {
    open(kind, payload) {
      activeKind = kind;
      dialog.classList.toggle("is-settings", kind === "settings");
      body.classList.toggle(
        "zotero-markdown-modal-body-settings",
        kind === "settings",
      );
      restoreFocus = doc.activeElement as HTMLElement | null;
      title.textContent = modalTitle(kind);
      body.replaceChildren();
      if (kind === "document-info")
        renderDocumentInfo(payload as DocumentModalData);
      else if (kind === "rename") renderRename(payload as DocumentModalData);
      else renderSettings(payload as Partial<SettingsModalData>);
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", "false");
      if (kind !== "rename") dialog.focus();
    },
    close: closeModal,
    destroy() {
      closeModal();
      backdrop.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      activeKind = null;
    },
  };
}

export function applySettings(settings: SettingsModalData) {
  const values = prefsFromSettings(settings);
  setPref("enable", values.enable);
  setPref("frontmatter", values.frontmatter);
  setPref("fontSize", values.fontSize);
  setPref("shortcutNewStandaloneMd", values.shortcutNewStandaloneMd);
}
