export type SettingsPageID = "general" | "editor" | "shortcuts" | "about";

export interface SettingsPage {
  id: SettingsPageID;
  label: string;
  icon: "settings" | "type" | "keyboard" | "info";
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "general", label: "常规", icon: "settings" },
  { id: "editor", label: "编辑器", icon: "type" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于", icon: "info" },
];

export function nextSettingsPage(
  current: SettingsPageID,
  direction: -1 | 1,
): SettingsPageID {
  const index = SETTINGS_PAGES.findIndex(({ id }) => id === current);
  const next =
    (index + direction + SETTINGS_PAGES.length) % SETTINGS_PAGES.length;
  return SETTINGS_PAGES[next].id;
}
