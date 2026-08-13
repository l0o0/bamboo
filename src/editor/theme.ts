import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import type {
  EditorMode,
  EditorTheme,
} from "../modules/markdown/editor-protocol";

const FONT_MONO =
  'ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const FONT_PROSE =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const livePreviewStyles = {
  // Visible MD markers on the active (source) line — muted, keep line metrics
  ".zmd-lp-syntax": {
    opacity: "0.45",
    fontWeight: "400",
  },
  // IMPORTANT: no margin on .cm-line — vertical margins break CM posAtCoords
  // (clicks land on the next/previous line). Use padding only.
  ".cm-line.zmd-lp-h1": {
    fontSize: "1.75em",
    fontWeight: "700",
    lineHeight: "1.3",
    paddingTop: "0.35em",
    paddingBottom: "0.15em",
  },
  ".cm-line.zmd-lp-h2": {
    fontSize: "1.4em",
    fontWeight: "650",
    lineHeight: "1.35",
    paddingTop: "0.3em",
    paddingBottom: "0.1em",
  },
  ".cm-line.zmd-lp-h3": {
    fontSize: "1.2em",
    fontWeight: "600",
    lineHeight: "1.4",
    paddingTop: "0.2em",
  },
  ".cm-line.zmd-lp-h4, .cm-line.zmd-lp-h5, .cm-line.zmd-lp-h6": {
    fontSize: "1.05em",
    fontWeight: "600",
  },
  ".cm-line.zmd-lp-list": {
    paddingLeft: "0",
  },
  ".zmd-lp-list-marker": {
    display: "inline-block",
    minWidth: "1.5em",
    whiteSpace: "pre",
    userSelect: "none",
  },
  ".cm-line.zmd-lp-quote": {
    borderLeft: "3px solid",
    paddingLeft: "0.75em",
    opacity: "0.92",
  },
  ".zmd-lp-strong": {
    fontWeight: "700",
  },
  ".zmd-lp-em": {
    fontStyle: "italic",
  },
  ".zmd-lp-strike": {
    textDecoration: "line-through",
  },
  ".zmd-lp-code": {
    fontFamily: FONT_MONO,
    fontSize: "0.9em",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".zmd-lp-link": {
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-line.zmd-lp-table-row": {
    display: "grid",
    gridTemplateColumns:
      "repeat(var(--zmd-table-columns), minmax(4.5rem, 1fr))",
    paddingLeft: "34px",
    paddingRight: "30px",
    borderLeft: "1px solid var(--zmd-table-border)",
    borderRight: "1px solid var(--zmd-table-border)",
    backgroundColor: "var(--zmd-table-bg)",
  },
  ".cm-line.zmd-lp-table-header": {
    borderTop: "1px solid var(--zmd-table-border)",
    borderBottom: "1px solid var(--zmd-table-border)",
    backgroundColor: "var(--zmd-table-header-bg)",
  },
  ".cm-line.zmd-lp-table-last-row": {
    borderBottom: "1px solid var(--zmd-table-border)",
  },
  ".cm-line.zmd-lp-table-delimiter": {
    height: "0",
    minHeight: "0",
    lineHeight: "0",
    overflow: "hidden",
  },
  ".cm-line.zmd-lp-table-source": {
    fontFamily: FONT_MONO,
    fontSize: "0.92em",
    backgroundColor: "var(--zmd-table-active-bg)",
  },
  ".cm-line.zmd-lp-table-delimiter-source": {
    fontFamily: FONT_MONO,
    fontSize: "0.92em",
    color: "var(--zmd-table-delimiter-text)",
    backgroundColor: "var(--zmd-table-active-bg)",
  },
  ".zmd-lp-table-cell": {
    display: "block",
    minWidth: "0",
    padding: "0.28em 0.65em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderRight: "1px solid var(--zmd-table-border)",
  },
  ".zmd-lp-table-cell:last-child": {
    borderRight: "none",
  },
  ".zmd-lp-table-header-cell": {
    fontWeight: "650",
  },
  ".zmd-lp-table-align-center": {
    textAlign: "center",
  },
  ".zmd-lp-table-align-right": {
    textAlign: "right",
  },
  ".cm-line.zmd-lp-code-block": {
    fontFamily: FONT_MONO,
    fontSize: "0.9em",
    backgroundColor: "var(--zmd-code-block-bg)",
  },
  ".cm-line.zmd-lp-code-fence": {
    fontFamily: FONT_MONO,
    fontSize: "0.9em",
    backgroundColor: "var(--zmd-code-block-bg)",
  },
  ".zmd-lp-image": {
    display: "block",
    width: "100%",
    padding: "0.55em 0",
    boxSizing: "border-box",
  },
  ".zmd-lp-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "32rem",
    objectFit: "contain",
    borderRadius: "4px",
  },
  ".zmd-lp-image-missing": {
    fontSize: "0.9em",
    padding: "0.65em 0.8em",
    border: "1px dashed currentColor",
    borderRadius: "4px",
    opacity: "0.65",
  },
};

const tableContextMenuStyles = {
  ".zmd-table-context-menu": {
    position: "fixed",
    zIndex: "100",
    width: "196px",
    padding: "6px",
    border: "1px solid var(--zmd-menu-border)",
    borderRadius: "8px",
    backgroundColor: "var(--zmd-menu-bg)",
    boxShadow: "0 10px 28px var(--zmd-menu-shadow)",
    boxSizing: "border-box",
    fontFamily: FONT_PROSE,
  },
  ".zmd-table-context-menu[hidden]": {
    display: "none",
  },
  ".zmd-table-context-item": {
    appearance: "none",
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: "32px",
    padding: "0 30px 0 10px",
    border: "none",
    borderRadius: "5px",
    backgroundColor: "transparent",
    color: "var(--zmd-menu-text)",
    font: "inherit",
    fontSize: "12px",
    letterSpacing: "0",
    textAlign: "left",
    cursor: "pointer",
  },
  ".zmd-table-context-item:hover:not(:disabled)": {
    backgroundColor: "var(--zmd-menu-hover)",
  },
  ".zmd-table-context-item:disabled": {
    color: "var(--zmd-menu-disabled)",
    cursor: "default",
  },
  ".zmd-table-context-item.is-checked::after": {
    content: '"✓"',
    position: "absolute",
    right: "10px",
    color: "var(--zmd-menu-check)",
    fontWeight: "700",
  },
  ".zmd-table-context-separator": {
    height: "1px",
    margin: "5px 4px",
    backgroundColor: "var(--zmd-menu-border)",
  },
};

export function liveEditorGeometry() {
  return {
    contentPadding: "20px 0 40px",
    // CodeMirror's default line inset is 6px left and 2px right. Moving the
    // former 28px content inset here keeps text fixed and selection geometry aligned.
    linePadding: "0 30px 0 34px",
  } as const;
}

export function editorThemeExtension(
  theme: EditorTheme,
  fontSize: number,
  mode: EditorMode = "source",
): Extension {
  const size = Math.min(22, Math.max(11, fontSize || 14));
  const isLive = mode === "live";
  const fontFamily = isLive ? FONT_PROSE : FONT_MONO;
  const lineHeight = isLive ? "1.7" : "1.55";
  const liveGeometry = liveEditorGeometry();
  const contentPadding = isLive ? liveGeometry.contentPadding : "14px 8px";

  if (theme === "dark") {
    return EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${size}px`,
          fontFamily,
          backgroundColor: "#1a1d24",
          color: "#e8eaed",
          "--zmd-code-block-bg": "rgba(255, 255, 255, 0.07)",
          "--zmd-table-bg": "rgba(255, 255, 255, 0.025)",
          "--zmd-table-header-bg": "rgba(255, 255, 255, 0.065)",
          "--zmd-table-active-bg": "rgba(96, 165, 250, 0.08)",
          "--zmd-table-border": "#3d4452",
          "--zmd-table-delimiter-text": "#9aa3b2",
          "--zmd-menu-bg": "#22262f",
          "--zmd-menu-border": "#3d4452",
          "--zmd-menu-text": "#e8eaed",
          "--zmd-menu-disabled": "#6b7280",
          "--zmd-menu-hover": "rgba(255, 255, 255, 0.08)",
          "--zmd-menu-check": "#60a5fa",
          "--zmd-menu-shadow": "rgba(0, 0, 0, 0.4)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily,
          lineHeight,
        },
        ".cm-content": {
          caretColor: "#60a5fa",
          padding: contentPadding,
          maxWidth: isLive ? "48rem" : "none",
          margin: isLive ? "0 auto" : "0",
        },
        ".cm-line": {
          padding: isLive ? liveGeometry.linePadding : "0 2px 0 6px",
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
        ...livePreviewStyles,
        ...tableContextMenuStyles,
        ".cm-line.zmd-lp-quote": {
          borderLeftColor: "#3d4452",
          color: "#c5cad3",
        },
        ".zmd-lp-list-marker": {
          ...livePreviewStyles[".zmd-lp-list-marker"],
          color: "#cbd5e1",
          fontWeight: "600",
        },
        ".cm-line.zmd-lp-list .zmd-lp-syntax": {
          color: "#cbd5e1",
          opacity: "0.8",
          fontWeight: "600",
        },
        ".zmd-lp-code": {
          ...livePreviewStyles[".zmd-lp-code"],
          backgroundColor: "rgba(255, 255, 255, 0.08)",
        },
        ".zmd-lp-link": {
          ...livePreviewStyles[".zmd-lp-link"],
          color: "#60a5fa",
        },
      },
      { dark: true },
    );
  }

  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${size}px`,
      fontFamily,
      backgroundColor: "#ffffff",
      color: "#111827",
      "--zmd-code-block-bg": "rgba(17, 24, 39, 0.055)",
      "--zmd-table-bg": "#ffffff",
      "--zmd-table-header-bg": "#f3f4f6",
      "--zmd-table-active-bg": "rgba(37, 99, 235, 0.055)",
      "--zmd-table-border": "#d1d5db",
      "--zmd-table-delimiter-text": "#6b7280",
      "--zmd-menu-bg": "#ffffff",
      "--zmd-menu-border": "#d1d5db",
      "--zmd-menu-text": "#111827",
      "--zmd-menu-disabled": "#9ca3af",
      "--zmd-menu-hover": "#f3f4f6",
      "--zmd-menu-check": "#2563eb",
      "--zmd-menu-shadow": "rgba(16, 24, 40, 0.16)",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily,
      lineHeight,
    },
    ".cm-content": {
      caretColor: "#2563eb",
      padding: contentPadding,
      maxWidth: isLive ? "48rem" : "none",
      margin: isLive ? "0 auto" : "0",
    },
    ".cm-line": {
      padding: isLive ? liveGeometry.linePadding : "0 2px 0 6px",
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
    ...livePreviewStyles,
    ...tableContextMenuStyles,
    ".cm-line.zmd-lp-quote": {
      borderLeftColor: "#d1d5db",
      color: "#4b5563",
    },
    ".zmd-lp-code": {
      ...livePreviewStyles[".zmd-lp-code"],
      backgroundColor: "rgba(0, 0, 0, 0.06)",
    },
    ".zmd-lp-link": {
      ...livePreviewStyles[".zmd-lp-link"],
      color: "#2563eb",
    },
  });
}
