export const SUPPORTED_CODE_LANGUAGES = {
  javascript: ["javascript", "js", "jsx"],
  typescript: ["typescript", "ts", "tsx"],
  json: ["json"],
  html: ["html", "xml"],
  css: ["css"],
  yaml: ["yaml", "yml"],
  markdown: ["markdown", "md"],
  bash: ["bash", "sh", "shell"],
  sql: ["sql"],
  python: ["python", "py"],
  java: ["java"],
  c: ["c"],
  cpp: ["cpp", "c++"],
  go: ["go"],
  rust: ["rust", "rs"],
} as const;

export type CanonicalCodeLanguage = keyof typeof SUPPORTED_CODE_LANGUAGES;

const LANGUAGE_BY_ALIAS = new Map<string, CanonicalCodeLanguage>(
  Object.entries(SUPPORTED_CODE_LANGUAGES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [alias, canonical as CanonicalCodeLanguage]),
  ),
);

export function fenceLanguageToken(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() || "";
}

export function normalizeFenceLanguage(
  info: string,
): CanonicalCodeLanguage | null {
  return LANGUAGE_BY_ALIAS.get(fenceLanguageToken(info)) || null;
}
