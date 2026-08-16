import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  type CanonicalCodeLanguage,
  normalizeFenceLanguage,
} from "../modules/markdown/code-language-aliases";

const CODEMIRROR_LANGUAGE_NAMES: Record<CanonicalCodeLanguage, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  yaml: "YAML",
  markdown: "Markdown",
  bash: "Shell",
  sql: "SQL",
  python: "Python",
  java: "Java",
  c: "C",
  cpp: "C++",
  go: "Go",
  rust: "Rust",
};

const DESCRIPTION_BY_NAME = new Map(
  languages.map((description) => [description.name.toLowerCase(), description]),
);

export function resolveCodeMirrorLanguage(
  info: string,
): LanguageDescription | null {
  const canonical = normalizeFenceLanguage(info);
  if (!canonical) return null;
  return (
    DESCRIPTION_BY_NAME.get(
      CODEMIRROR_LANGUAGE_NAMES[canonical].toLowerCase(),
    ) || null
  );
}
