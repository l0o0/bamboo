export const THEME_TOKENS = {
  light: {
    bg: "#fbfbfc",
    surface: "#ffffff",
    surface2: "#f3f4f6",
    border: "#e5e7eb",
    borderStrong: "#d1d5db",
    text: "#111827",
    textMuted: "#6b7280",
    textFaint: "#9ca3af",
    accent: "#2563eb",
    accentSoft: "rgba(37, 99, 235, 0.12)",
    accentHover: "#1d4ed8",
    success: "#059669",
    successSoft: "rgba(5, 150, 105, 0.12)",
    warn: "#d97706",
    danger: "#dc2626",
    shadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
    selection: "rgba(37, 99, 235, 0.16)",
    activeLine: "rgba(37, 99, 235, 0.04)",
    tableBg: "#ffffff",
    tableHeaderBg: "#f3f4f6",
    tableActiveBg: "rgba(37, 99, 235, 0.055)",
    codeBlockBg: "rgba(17, 24, 39, 0.055)",
    menuShadow: "rgba(16, 24, 40, 0.16)",
  },
  dark: {
    bg: "#12141a",
    surface: "#1a1d24",
    surface2: "#22262f",
    border: "#2e3440",
    borderStrong: "#3d4452",
    text: "#e8eaed",
    textMuted: "#9aa3b2",
    textFaint: "#6b7280",
    accent: "#60a5fa",
    accentSoft: "rgba(96, 165, 250, 0.16)",
    accentHover: "#93c5fd",
    success: "#34d399",
    successSoft: "rgba(52, 211, 153, 0.14)",
    warn: "#d97706",
    danger: "#dc2626",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
    selection: "rgba(96, 165, 250, 0.28)",
    activeLine: "rgba(255, 255, 255, 0.04)",
    tableBg: "rgba(255, 255, 255, 0.025)",
    tableHeaderBg: "rgba(255, 255, 255, 0.065)",
    tableActiveBg: "rgba(96, 165, 250, 0.08)",
    codeBlockBg: "rgba(255, 255, 255, 0.07)",
    menuShadow: "rgba(0, 0, 0, 0.4)",
  },
} as const;

export type ThemeTokenSet = (typeof THEME_TOKENS)[keyof typeof THEME_TOKENS];

export function themeTokenCss(selector: string, tokens: ThemeTokenSet): string {
  return `${selector} {
  --zmd-bg: ${tokens.bg};
  --zmd-surface: ${tokens.surface};
  --zmd-surface-2: ${tokens.surface2};
  --zmd-border: ${tokens.border};
  --zmd-border-strong: ${tokens.borderStrong};
  --zmd-text: ${tokens.text};
  --zmd-text-muted: ${tokens.textMuted};
  --zmd-text-faint: ${tokens.textFaint};
  --zmd-accent: ${tokens.accent};
  --zmd-accent-soft: ${tokens.accentSoft};
  --zmd-accent-hover: ${tokens.accentHover};
  --zmd-success: ${tokens.success};
  --zmd-success-soft: ${tokens.successSoft};
  --zmd-warn: ${tokens.warn};
  --zmd-danger: ${tokens.danger};
  --zmd-shadow: ${tokens.shadow};
  --zmd-radius: 8px;
  --zmd-radius-sm: 6px;
  --zmd-font-ui: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}`;
}
