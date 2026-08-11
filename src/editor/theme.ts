import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import type { EditorTheme } from "../modules/markdown/editor-protocol";

const FONT_FAMILY =
  'ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function editorThemeExtension(
  theme: EditorTheme,
  fontSize: number,
): Extension {
  const size = Math.min(22, Math.max(11, fontSize || 14));
  if (theme === "dark") {
    return EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${size}px`,
          fontFamily: FONT_FAMILY,
          backgroundColor: "#1a1d24",
          color: "#e8eaed",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: FONT_FAMILY,
          lineHeight: "1.55",
        },
        ".cm-content": {
          caretColor: "#60a5fa",
          padding: "14px 8px",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "#60a5fa",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          {
            backgroundColor: "rgba(96, 165, 250, 0.28)",
          },
        ".cm-activeLine": {
          backgroundColor: "rgba(255, 255, 255, 0.04)",
        },
        ".cm-gutters": {
          backgroundColor: "#22262f",
          color: "#6b7280",
          border: "none",
          borderRight: "1px solid #2e3440",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "rgba(255, 255, 255, 0.06)",
          color: "#9aa3b2",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          padding: "0 10px 0 8px",
          minWidth: "2.5em",
        },
      },
      { dark: true },
    );
  }

  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${size}px`,
      fontFamily: FONT_FAMILY,
      backgroundColor: "#ffffff",
      color: "#111827",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: FONT_FAMILY,
      lineHeight: "1.55",
    },
    ".cm-content": {
      caretColor: "#2563eb",
      padding: "14px 8px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#2563eb",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(37, 99, 235, 0.16)",
      },
    ".cm-activeLine": {
      backgroundColor: "rgba(37, 99, 235, 0.04)",
    },
    ".cm-gutters": {
      backgroundColor: "#f3f4f6",
      color: "#9ca3af",
      border: "none",
      borderRight: "1px solid #e5e7eb",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(37, 99, 235, 0.06)",
      color: "#6b7280",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 8px",
      minWidth: "2.5em",
    },
  });
}
