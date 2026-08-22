import { getPref, setPref } from "../../utils/prefs";

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
  onNativeSettings?: () => void;
  onClose?: () => void;
}

export interface MarkdownModalController {
  open: (
    kind: ModalKind,
    payload?: DocumentModalData | Partial<SettingsModalData>,
  ) => void;
  close: () => void;
  destroy: () => void;
}

const MODAL_TITLES: Record<ModalKind, string> = {
  "document-info": "文档信息",
  rename: "重命名",
  settings: "设置",
};

export function modalTitle(kind: ModalKind): string {
  return MODAL_TITLES[kind];
}

export function normalizeMarkdownFilename(value: string): string {
  const trimmed = value.trim().replace(/\.md$/i, "");
  const safe = trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${safe || "Note"}.md`;
}

export function formatModalBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
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

function textElement(doc: Document, tag: string, text: string, className?: string) {
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
  close.setAttribute("aria-label", "关闭");
  const header = doc.createElement("header");
  header.className = "zotero-markdown-modal-header";
  header.append(title, close);
  const body = doc.createElement("div");
  body.className = "zotero-markdown-modal-body";
  dialog.append(header, body);
  backdrop.appendChild(dialog);
  doc.body.appendChild(backdrop);

  let activeKind: ModalKind | null = null;
  let restoreFocus: HTMLElement | null = null;

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
      ["文件名", data.title || "—"],
      ["文件路径", data.path || "—"],
      ["文件大小", formatModalBytes(data.size)],
      ["图片数量", String(data.imageCount)],
      ["创建时间", formatModalDate(data.created)],
      ["修改时间", formatModalDate(data.modified)],
      ["存储类型", data.storageLabel || "—"],
    ];
    const list = doc.createElement("dl");
    list.className = "zotero-markdown-modal-info";
    for (const [label, value] of rows) {
      list.append(textElement(doc, "dt", label), textElement(doc, "dd", value));
    }
    body.appendChild(list);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(button(doc, "在文件夹中显示", "reveal"));
    body.appendChild(footer);
  };

  const renderRename = (data: DocumentModalData) => {
    const label = textElement(doc, "label", "文件名", "zotero-markdown-modal-label");
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
    footer.append(button(doc, "取消", "close"), button(doc, "重命名", "rename", true));
    body.appendChild(footer);
    input.focus();
    input.select();
  };

  const renderSettings = (payload: Partial<SettingsModalData> = {}) => {
    const settings = settingsFromPrefs({
      enable: payload.enable ?? Boolean(getPref("enable")),
      frontmatter: payload.frontmatter ?? Boolean(getPref("frontmatter")),
      fontSize: payload.fontSize ?? (Number(getPref("fontSize")) || 14),
      shortcutNewStandaloneMd:
        payload.shortcutNewStandaloneMd ?? String(getPref("shortcutNewStandaloneMd") || ""),
    });
    const form = doc.createElement("form");
    form.className = "zotero-markdown-modal-settings";
    const checkbox = (name: "enable" | "frontmatter", labelText: string) => {
      const label = doc.createElement("label");
      label.className = "zotero-markdown-modal-check";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.name = name;
      input.checked = settings[name];
      label.append(input, textElement(doc, "span", labelText));
      form.appendChild(label);
    };
    checkbox("enable", "使用 Markdown 编辑器打开 .md 附件");
    checkbox("frontmatter", "新建笔记时写入 YAML frontmatter");
    const sizeLabel = textElement(doc, "label", "编辑器字号", "zotero-markdown-modal-label");
    const size = doc.createElement("input");
    size.type = "number";
    size.name = "fontSize";
    size.min = "11";
    size.max = "22";
    size.step = "1";
    size.value = String(settings.fontSize);
    size.className = "zotero-markdown-modal-input is-small";
    sizeLabel.appendChild(size);
    form.appendChild(sizeLabel);
    const shortcutLabel = textElement(doc, "label", "新建独立 Markdown 快捷键", "zotero-markdown-modal-label");
    const shortcut = doc.createElement("input");
    shortcut.type = "text";
    shortcut.name = "shortcutNewStandaloneMd";
    shortcut.value = settings.shortcutNewStandaloneMd;
    shortcut.className = "zotero-markdown-modal-input";
    shortcutLabel.appendChild(shortcut);
    form.appendChild(shortcutLabel);
    const footer = doc.createElement("footer");
    footer.className = "zotero-markdown-modal-footer";
    footer.append(button(doc, "打开 Zotero 设置", "native-settings"), button(doc, "保存", "save-settings", true));
    form.appendChild(footer);
    form.addEventListener("submit", (event) => event.preventDefault());
    body.appendChild(form);
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target === backdrop) return closeModal();
    const action = target?.closest?.("[data-modal-action]")?.getAttribute("data-modal-action");
    if (!action) return;
    if (action === "close") return closeModal();
    if (action === "reveal") return void callbacks.onReveal?.();
    if (action === "native-settings") return callbacks.onNativeSettings?.();
    if (action === "rename") {
      const input = body.querySelector<HTMLInputElement>('input[name="filename"]');
      const filename = normalizeMarkdownFilename(input?.value || "");
      return void Promise.resolve(callbacks.onRename?.(filename)).then(closeModal);
    }
    if (action === "save-settings") {
      const get = (name: string) => body.querySelector<HTMLInputElement>(`[name="${name}"]`);
      const settings = prefsFromSettings({
        enable: !!get("enable")?.checked,
        frontmatter: !!get("frontmatter")?.checked,
        fontSize: Number(get("fontSize")?.value) || 14,
        shortcutNewStandaloneMd: get("shortcutNewStandaloneMd")?.value || "",
      });
      return void Promise.resolve(callbacks.onSettings?.(settings)).then(closeModal);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeModal();
  };
  backdrop.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeyDown);

  return {
    open(kind, payload) {
      activeKind = kind;
      restoreFocus = doc.activeElement as HTMLElement | null;
      title.textContent = modalTitle(kind);
      body.replaceChildren();
      if (kind === "document-info") renderDocumentInfo(payload as DocumentModalData);
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
