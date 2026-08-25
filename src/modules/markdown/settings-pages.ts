import { getString } from "../../utils/locale";
import type { FluentMessageId } from "../../../typings/i10n";

export type SettingsPageID = "general" | "editor" | "shortcuts" | "about";

export interface SettingsPage {
  id: SettingsPageID;
  icon: "settings" | "type" | "keyboard" | "info";
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "general", icon: "settings" },
  { id: "editor", icon: "type" },
  { id: "shortcuts", icon: "keyboard" },
  { id: "about", icon: "info" },
];

/** Fluent key for a settings page label. */
export function settingsPageLabelKey(id: SettingsPageID): FluentMessageId {
  return `settings-page-${id}` as FluentMessageId;
}

export function settingsPageLabel(id: SettingsPageID): string {
  return getString(settingsPageLabelKey(id));
}

export function nextSettingsPage(
  current: SettingsPageID,
  direction: -1 | 1,
): SettingsPageID {
  const index = SETTINGS_PAGES.findIndex(({ id }) => id === current);
  const next =
    (index + direction + SETTINGS_PAGES.length) % SETTINGS_PAGES.length;
  return SETTINGS_PAGES[next].id;
}
