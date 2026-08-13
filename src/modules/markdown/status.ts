import type { EditorStats } from "./editor-protocol";

export function formatStats(stats: EditorStats): string {
  return `${stats.words} words · ${stats.lines} lines`;
}

export function formatSavedStatus(savedAt: Date): string {
  const time = savedAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `已保存 ${time} · 自动保存已开启`;
}
