export const DEFAULT_NEW_MARKDOWN_SHORTCUT = "accel,shift,M";

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "OS",
  "Shift",
]);

function isMacPlatform(platform?: string): boolean {
  const value = platform ?? globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(value);
}

export function isShortcutModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

export function resolveConfiguredShortcut(
  value: string | null | undefined,
): string {
  return value ?? DEFAULT_NEW_MARKDOWN_SHORTCUT;
}

export function shortcutKeycaps(raw: string, platform?: string): string[] {
  const mac = isMacPlatform(platform);
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      switch (token.toLowerCase()) {
        case "accel":
          return mac ? "⌘" : "Ctrl";
        case "control":
        case "ctrl":
          return mac ? "⌃" : "Ctrl";
        case "alt":
          return mac ? "⌥" : "Alt";
        case "shift":
          return mac ? "⇧" : "Shift";
        case "meta":
          return mac ? "⌘" : "Meta";
        default:
          return token.length === 1 ? token.toUpperCase() : token;
      }
    });
}

export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  platform?: string,
): string | null {
  if (!event.key || isShortcutModifierKey(event.key)) return null;
  const mac = isMacPlatform(platform);
  const tokens: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) tokens.push("accel");
  if (mac && event.ctrlKey) tokens.push("control");
  if (!mac && event.metaKey) tokens.push("meta");
  if (event.altKey) tokens.push("alt");
  if (event.shiftKey) tokens.push("shift");
  if (!tokens.length) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  tokens.push(key);
  return tokens.join(",");
}
