import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";

export type MoreMenuAction =
  | "document-info"
  | "rename"
  | "show-in-folder"
  | "find"
  | "source"
  | "mode"
  | "export-pdf"
  | "export-html"
  | "shortcuts"
  | "settings"
  | "import-external-images"
  | "cleanup-images";

export interface MoreMenuItem {
  action: MoreMenuAction;
  shortcut?: string;
  submenu?: boolean;
}

export const EDITOR_MODE_OPTIONS = [
  { mode: "live" },
  { mode: "source" },
  { mode: "preview" },
] as const;

export function findShortcutLabel(platform?: string): string {
  const value = platform ?? globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(value) ? "⌘F" : "Ctrl+F";
}

export const MORE_MENU_SECTIONS: readonly (readonly MoreMenuItem[])[] = [
  [
    { action: "document-info" },
    { action: "rename" },
    { action: "show-in-folder" },
  ],
  [
    { action: "find", shortcut: findShortcutLabel() },
    { action: "source" },
    { action: "mode", submenu: true },
  ],
  [{ action: "export-pdf" }, { action: "export-html" }],
  [
    { action: "import-external-images" },
    { action: "cleanup-images" },
    { action: "shortcuts" },
    { action: "settings" },
  ],
];

/** Fluent key for a kebab-menu action label. */
export function moreMenuLabelKey(action: MoreMenuAction): FluentMessageId {
  return `more-${action}` as FluentMessageId;
}

export function moreMenuLabel(action: MoreMenuAction): string {
  return getString(moreMenuLabelKey(action));
}

/** Fluent key for an editor mode label. */
export function modeLabelKey(
  mode: "live" | "source" | "preview",
): FluentMessageId {
  return `tab-mode-${mode}` as FluentMessageId;
}

export function modeLabel(mode: "live" | "source" | "preview"): string {
  return getString(modeLabelKey(mode));
}
