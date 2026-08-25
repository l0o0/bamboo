import type { EditorStats } from "./editor-protocol";
import { getString } from "../../utils/locale";

export function formatStats(stats: EditorStats): string {
  return getString("status-stats", {
    args: { words: stats.words, lines: stats.lines },
  });
}

export function formatSavedStatus(savedAt: Date): string {
  const time = savedAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return getString("status-saved-at", { args: { time } });
}
