import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import {
  SUPPORTED_CODE_LANGUAGES,
  fenceLanguageToken,
} from "../modules/markdown/code-language-aliases";

const aliases = (
  language: keyof typeof SUPPORTED_CODE_LANGUAGES,
  exclude: readonly string[] = [],
) =>
  SUPPORTED_CODE_LANGUAGES[language].filter(
    (alias) => !exclude.includes(alias),
  );

export const CODEMIRROR_CODE_LANGUAGES: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: aliases("javascript", ["jsx"]),
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript(),
      ),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: aliases("typescript", ["tsx"]),
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ jsx: true, typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: aliases("json"),
    load: () => import("@codemirror/lang-json").then(({ json }) => json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: aliases("html"),
    load: () => import("@codemirror/lang-html").then(({ html }) => html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: aliases("css"),
    load: () => import("@codemirror/lang-css").then(({ css }) => css()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: aliases("yaml"),
    load: () => import("@codemirror/lang-yaml").then(({ yaml }) => yaml()),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: aliases("markdown"),
    load: () =>
      import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: aliases("bash"),
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(
        ({ shell }) => new LanguageSupport(StreamLanguage.define(shell)),
      ),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: aliases("sql"),
    load: () => import("@codemirror/lang-sql").then(({ sql }) => sql()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: aliases("python"),
    load: () =>
      import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "Java",
    alias: aliases("java"),
    load: () => import("@codemirror/lang-java").then(({ java }) => java()),
  }),
  LanguageDescription.of({
    name: "C",
    alias: aliases("c"),
    load: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: aliases("cpp"),
    load: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: aliases("go"),
    load: () => import("@codemirror/lang-go").then(({ go }) => go()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: aliases("rust"),
    load: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  }),
];

export function resolveCodeMirrorLanguage(
  info: string,
): LanguageDescription | null {
  const language = fenceLanguageToken(info);
  if (!language) return null;
  return LanguageDescription.matchLanguageName(
    CODEMIRROR_CODE_LANGUAGES,
    language,
    false,
  );
}
