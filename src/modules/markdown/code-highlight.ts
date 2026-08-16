import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import {
  type CanonicalCodeLanguage,
  normalizeFenceLanguage,
} from "./code-language-aliases";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("python", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);

const HIGHLIGHT_LANGUAGE_NAMES: Record<CanonicalCodeLanguage, string> = {
  javascript: "javascript",
  typescript: "typescript",
  json: "json",
  html: "xml",
  css: "css",
  yaml: "yaml",
  markdown: "markdown",
  bash: "bash",
  sql: "sql",
  python: "python",
  java: "java",
  c: "c",
  cpp: "cpp",
  go: "go",
  rust: "rust",
};

export function highlightFencedCode(
  source: string,
  info: string,
): string | null {
  const canonical = normalizeFenceLanguage(info);
  if (!canonical) return null;
  try {
    return hljs.highlight(source, {
      language: HIGHLIGHT_LANGUAGE_NAMES[canonical],
      ignoreIllegals: true,
    }).value;
  } catch {
    return null;
  }
}
