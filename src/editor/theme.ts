import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import type {
  EditorMode,
  EditorSurface,
  EditorTheme,
} from "../modules/markdown/editor-protocol";
import { THEME_TOKENS } from "../modules/markdown/theme-tokens";

const FONT_MONO =
  'ui-monospace, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const FONT_PROSE =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

// Shared horizontal insets of the live reading column (see DESIGN.md): a
// 44rem usable track inside the centered 48rem column. The asymmetry is
// deliberate — 34px left reserves room for table row handles, 30px right
// matches the add-column rail width (tableEdgeSize).
const LIVE_INSET_LEFT = "34px";
const SIDEBAR_LIVE_INSET_LEFT = "20px";
const LIVE_INSET_RIGHT = "30px";

function createLiveEditorGeometry(leftInset: string) {
  return {
    contentPadding: "4px 0 8px",
    linePadding: `0 ${LIVE_INSET_RIGHT} 0 ${leftInset}`,
    tableMargin: `0 ${LIVE_INSET_RIGHT} 0 ${leftInset}`,
    tablePadding: "0",
    tableEdgeSize: LIVE_INSET_RIGHT,
    tableCellMinHeight: "1.7em",
  } as const;
}

const LIVE_EDITOR_GEOMETRY = createLiveEditorGeometry(LIVE_INSET_LEFT);

function createLivePreviewStyles(
  liveGeometry: ReturnType<typeof createLiveEditorGeometry>,
) {
  return {
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
    // Lists keep the shared line inset (34px left): the marker's own min-width
    // provides the item indent, so bullets align with paragraph text.
    ".zmd-lp-list-marker": {
      display: "inline-block",
      minWidth: "1.5em",
      whiteSpace: "pre",
      userSelect: "none",
    },
    ".cm-line.zmd-lp-quote": {
      borderLeft: "3px solid",
      // Keep the prose left inset; the extra 0.75em is the quote indent.
      paddingLeft: `calc(${LIVE_INSET_LEFT} + 0.75em)`,
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
    // Borders live on cells, not the CM line. Line borders sit outside the
    // padding box that positions edge actions, so they drift by 1px from cell
    // borders on the last row and split the add-column rail into blocks.
    ".cm-line.zmd-lp-table-row": {
      position: "relative",
      display: "grid",
      gridTemplateColumns:
        "repeat(var(--zmd-table-columns), minmax(4.5rem, 1fr))",
      margin: liveGeometry.tableMargin,
      padding: liveGeometry.tablePadding,
      boxSizing: "border-box",
      overflow: "visible",
      border: "none",
      backgroundColor: "transparent",
    },
    ".cm-line.zmd-lp-table-row.cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-line.zmd-lp-table-last-row": {
      paddingBottom: liveGeometry.tableEdgeSize,
    },
    ".cm-line.zmd-lp-table-delimiter": {
      height: "0",
      minHeight: "0",
      maxHeight: "0",
      padding: "0",
      margin: "0",
      border: "none",
      lineHeight: "0",
      fontSize: "0",
      overflow: "hidden",
    },
    ".cm-line.zmd-lp-table-delimiter.cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-line.zmd-lp-table-delimiter > *": {
      display: "none",
    },
    ".zmd-lp-table-cell": {
      display: "block",
      boxSizing: "border-box",
      gridRow: "1",
      minWidth: "0",
      minHeight: liveGeometry.tableCellMinHeight,
      lineHeight: "1.7",
      padding: "0.28em 0.65em",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      backgroundColor: "var(--zmd-table-bg)",
      borderBottom: "1px solid var(--zmd-table-border)",
      borderRight: "1px solid var(--zmd-table-border)",
    },
    '.zmd-lp-table-cell[data-zmd-table-cell-column="0"]': {
      borderLeft: "1px solid var(--zmd-table-border)",
    },
    ".zmd-lp-table-header-cell": {
      fontWeight: "650",
      backgroundColor: "var(--zmd-table-header-bg)",
      borderTop: "1px solid var(--zmd-table-border)",
    },
    ".zmd-lp-table-cell-active": {
      backgroundColor: "var(--zmd-table-active-bg)",
    },
    ".zmd-lp-table-cell.zmd-lp-table-cell-selected": {
      backgroundColor: "var(--zmd-table-selection-bg)",
      boxShadow: "inset 0 0 0 2px var(--zmd-table-selection-line)",
    },
    ".zmd-lp-table-cell.zmd-lp-table-drag-source": {
      backgroundColor: "var(--zmd-drag-source-bg)",
      boxShadow: "inset 0 0 0 1px var(--zmd-drag-source-line)",
    },
    ".zmd-lp-table-cell.zmd-lp-table-drop-target": {
      backgroundColor: "var(--zmd-drag-target-bg)",
      boxShadow: "inset 0 0 0 1px var(--zmd-drag-target-line)",
    },
    ".zmd-lp-table-cell-editing": {
      minHeight: "1.35em",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      textOverflow: "clip",
      outline: "none",
      caretColor: "currentColor",
      cursor: "text",
    },
    ".cm-line.zmd-lp-table-row > .cm-widgetBuffer": {
      display: "none",
    },
    '.cm-line.zmd-lp-table-row > span[contenteditable="false"]:empty': {
      display: "none",
    },
    ".cm-line.zmd-lp-table-row > br": {
      display: "none",
    },
    ".cm-line.zmd-lp-table-row > :not(.zmd-lp-table-cell):not(.zmd-lp-table-edge-actions)":
      {
        display: "none",
      },
    ".zmd-lp-table-edge-actions": {
      position: "absolute",
      inset: "0",
      display: "grid",
      gridTemplateColumns:
        "repeat(var(--zmd-table-columns), minmax(4.5rem, 1fr))",
      gridTemplateRows: "1fr",
      gridColumn: "1 / -1",
      gridRow: "1",
      zIndex: "2",
      pointerEvents: "none",
      "--zmd-table-edge-size": liveGeometry.tableEdgeSize,
    },
    ".zmd-lp-table-row-handle": {
      position: "absolute",
      top: "0",
      bottom: "0",
      left: "-20px",
      width: "16px",
      padding: "0",
      border: "1px solid var(--zmd-table-border)",
      borderRadius: "4px",
      backgroundColor: "var(--zmd-table-header-bg)",
      color: "var(--zmd-table-delimiter-text)",
      display: "grid",
      placeItems: "center",
      opacity: "0",
      cursor: "grab",
      pointerEvents: "auto",
      zIndex: "3",
    },
    ".zmd-lp-table-row-handle::before": {
      content: '"⋮"',
      fontSize: "13px",
      lineHeight: "1",
    },
    ".cm-line.zmd-lp-table-last-row .zmd-lp-table-row-handle": {
      bottom: "var(--zmd-table-edge-size)",
    },
    ".cm-line.zmd-lp-table-row:hover .zmd-lp-table-row-handle": {
      opacity: "1",
    },
    ".zmd-lp-table-row-handle:active": {
      cursor: "grabbing",
    },
    ".zmd-lp-table-column-handle": {
      gridRow: "1",
      alignSelf: "start",
      justifySelf: "center",
      width: "32px",
      height: "16px",
      marginTop: "-20px",
      padding: "0",
      border: "1px solid var(--zmd-table-border)",
      borderRadius: "4px",
      backgroundColor: "var(--zmd-table-header-bg)",
      color: "var(--zmd-table-delimiter-text)",
      display: "grid",
      placeItems: "center",
      opacity: "0",
      cursor: "grab",
      pointerEvents: "auto",
      zIndex: "3",
    },
    ".zmd-lp-table-column-handle::before": {
      content: '"⋯"',
      fontSize: "13px",
      lineHeight: "1",
      letterSpacing: "1px",
    },
    ".zmd-lp-table-column-handle:hover": {
      opacity: "1",
    },
    ".zmd-lp-table-row-handle.is-selected, .zmd-lp-table-column-handle.is-selected":
      {
        opacity: "1",
        backgroundColor: "var(--zmd-table-selection-bg)",
        borderColor: "var(--zmd-table-selection-line)",
        color: "var(--zmd-table-selection-line)",
      },
    ".zmd-lp-table-column-handle:active": {
      cursor: "grabbing",
    },
    ".zmd-lp-table-edge-action": {
      position: "absolute",
      boxSizing: "border-box",
      display: "grid",
      placeItems: "center",
      padding: "0",
      border: "1px solid var(--zmd-table-border)",
      backgroundColor: "var(--zmd-table-bg)",
      color: "var(--zmd-table-delimiter-text)",
      font: "inherit",
      fontSize: "1.45em",
      fontWeight: "400",
      lineHeight: "1",
      opacity: "0",
      cursor: "pointer",
      pointerEvents: "auto",
      transition: "opacity 120ms ease-out, background-color 120ms ease-out",
    },
    ".zmd-lp-table-edge-action.is-column": {
      top: "0",
      left: "100%",
      width: liveGeometry.tableEdgeSize,
      height: "100%",
      overflow: "hidden",
      border: "none",
      borderTop: "1px solid var(--zmd-table-border)",
      borderRight: "1px solid var(--zmd-table-border)",
      borderBottom: "1px solid var(--zmd-table-border)",
      backgroundColor: "var(--zmd-table-bg)",
      color: "transparent",
    },
    ".zmd-lp-table-edge-action.is-row": {
      top: "auto",
      bottom: "0",
      left: "0",
      width: "100%",
      height: liveGeometry.tableEdgeSize,
      borderTop: "0",
    },
    ".zmd-lp-table-edge-action.is-column .zmd-lp-table-edge-glyph": {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      color: "var(--zmd-table-delimiter-text)",
      pointerEvents: "none",
    },
    ".zmd-lp-table-edge-action.is-column.is-table-hovered": {
      opacity: "1",
      color: "transparent",
      backgroundColor: "var(--zmd-table-active-bg)",
    },
    ".zmd-lp-table-edge-action:not(.is-column):hover, .zmd-lp-table-edge-action:not(.is-column):focus-visible":
      {
        opacity: "1",
        color: "var(--zmd-table-delimiter-text)",
        backgroundColor: "var(--zmd-table-active-bg)",
        outline: "none",
      },
    ".zmd-lp-table-edge-action.is-column:hover, .zmd-lp-table-edge-action.is-column:focus-visible":
      {
        opacity: "1",
        color: "transparent",
        backgroundColor: "var(--zmd-table-active-bg)",
        outline: "none",
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
      backgroundClip: "content-box",
    },
    ".cm-line.zmd-lp-code-fence": {
      fontFamily: FONT_MONO,
      fontSize: "0.9em",
      backgroundColor: "var(--zmd-code-block-bg)",
      backgroundClip: "content-box",
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
}

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

export function liveEditorGeometry(surface: EditorSurface = "default") {
  return surface === "sidebar"
    ? createLiveEditorGeometry(SIDEBAR_LIVE_INSET_LEFT)
    : LIVE_EDITOR_GEOMETRY;
}

export function codeSyntaxHighlighting(theme: EditorTheme): Extension {
  const tokens = THEME_TOKENS[theme];
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment],
        color: tokens.codeComment,
      },
      {
        tag: [tags.keyword, tags.operatorKeyword, tags.operator],
        color: tokens.codeKeyword,
      },
      {
        tag: [tags.string, tags.special(tags.string)],
        color: tokens.codeString,
      },
      {
        tag: [tags.number, tags.bool, tags.null],
        color: tokens.codeNumber,
      },
      {
        tag: [tags.function(tags.variableName), tags.className],
        color: tokens.codeFunction,
      },
      {
        tag: [tags.variableName, tags.propertyName, tags.attributeName],
        color: tokens.codeVariable,
      },
      { tag: tags.tagName, color: tokens.codeTag },
      {
        tag: [tags.punctuation, tags.bracket],
        color: tokens.codePunctuation,
      },
      {
        tag: tags.invalid,
        color: tokens.codeInvalid,
        textDecoration: "underline",
      },
    ]),
    { fallback: true },
  );
}

export function livePreviewGeometryStyles(surface: EditorSurface = "default") {
  const geometry = liveEditorGeometry(surface);
  const tableRow =
    createLivePreviewStyles(geometry)[".cm-line.zmd-lp-table-row"];
  const codeBlock =
    createLivePreviewStyles(geometry)[".cm-line.zmd-lp-code-block"];
  return {
    tableMargin: tableRow.margin,
    tablePadding: tableRow.padding,
    tableEdgeSize: geometry.tableEdgeSize,
    codeBlockBackgroundClip: codeBlock.backgroundClip,
  };
}

export function editorThemeExtension(
  theme: EditorTheme,
  fontSize: number,
  mode: EditorMode = "source",
  surface: EditorSurface = "default",
): Extension {
  const size = Math.min(22, Math.max(11, fontSize || 14));
  const isLive = mode === "live";
  const fontFamily = isLive ? FONT_PROSE : FONT_MONO;
  const lineHeight = isLive ? "1.7" : "1.55";
  const liveGeometry = liveEditorGeometry(surface);
  const livePreviewStyles = createLivePreviewStyles(liveGeometry);
  const contentPadding = isLive ? liveGeometry.contentPadding : "14px 8px";

  if (theme === "dark") {
    const tokens = THEME_TOKENS.dark;
    return EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${size}px`,
          fontFamily,
          backgroundColor: tokens.surface,
          color: tokens.text,
          "--zmd-code-block-bg": tokens.codeBlockBg,
          "--zmd-table-bg": tokens.tableBg,
          "--zmd-table-header-bg": tokens.tableHeaderBg,
          "--zmd-table-active-bg": tokens.tableActiveBg,
          "--zmd-table-selection-bg": tokens.accentSoft,
          "--zmd-table-selection-line": tokens.accent,
          "--zmd-table-border": tokens.borderStrong,
          "--zmd-table-delimiter-text": tokens.textMuted,
          "--zmd-drag-source-bg": tokens.accentSoft,
          "--zmd-drag-source-line": tokens.accent,
          "--zmd-drag-target-bg": tokens.successSoft,
          "--zmd-drag-target-line": tokens.success,
          "--zmd-menu-bg": tokens.surface2,
          "--zmd-menu-border": tokens.borderStrong,
          "--zmd-menu-text": tokens.text,
          "--zmd-menu-disabled": tokens.textFaint,
          "--zmd-menu-hover": "rgba(255, 255, 255, 0.08)",
          "--zmd-menu-check": tokens.accent,
          "--zmd-menu-shadow": tokens.menuShadow,
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily,
          lineHeight,
        },
        ".cm-content": {
          caretColor: tokens.accent,
          padding: contentPadding,
          maxWidth: isLive ? "48rem" : "none",
          margin: isLive ? "0 auto" : "0",
        },
        ".cm-line": {
          padding: isLive ? liveGeometry.linePadding : "0 2px 0 6px",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: tokens.accent,
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          {
            backgroundColor: tokens.selection,
          },
        ".cm-activeLine": {
          backgroundColor: tokens.activeLine,
        },
        ".cm-gutters": {
          backgroundColor: tokens.surface2,
          color: tokens.textFaint,
          border: "none",
          borderRight: `1px solid ${tokens.border}`,
        },
        ".cm-activeLineGutter": {
          backgroundColor: "rgba(255, 255, 255, 0.06)",
          color: tokens.textMuted,
        },
        ".cm-lineNumbers .cm-gutterElement": {
          padding: "0 10px 0 8px",
          minWidth: "2.5em",
        },
        ...livePreviewStyles,
        ...tableContextMenuStyles,
        ".cm-line.zmd-lp-quote": {
          borderLeftColor: tokens.borderStrong,
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
          color: tokens.accent,
        },
      },
      { dark: true },
    );
  }

  const tokens = THEME_TOKENS.light;
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${size}px`,
      fontFamily,
      backgroundColor: tokens.surface,
      color: tokens.text,
      "--zmd-code-block-bg": tokens.codeBlockBg,
      "--zmd-table-bg": tokens.tableBg,
      "--zmd-table-header-bg": tokens.tableHeaderBg,
      "--zmd-table-active-bg": tokens.tableActiveBg,
      "--zmd-table-selection-bg": tokens.accentSoft,
      "--zmd-table-selection-line": tokens.accent,
      "--zmd-table-border": tokens.borderStrong,
      "--zmd-table-delimiter-text": tokens.textMuted,
      "--zmd-drag-source-bg": tokens.accentSoft,
      "--zmd-drag-source-line": tokens.accent,
      "--zmd-drag-target-bg": tokens.successSoft,
      "--zmd-drag-target-line": tokens.success,
      "--zmd-menu-bg": tokens.surface,
      "--zmd-menu-border": tokens.borderStrong,
      "--zmd-menu-text": tokens.text,
      "--zmd-menu-disabled": tokens.textFaint,
      "--zmd-menu-hover": tokens.surface2,
      "--zmd-menu-check": tokens.accent,
      "--zmd-menu-shadow": tokens.menuShadow,
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily,
      lineHeight,
    },
    ".cm-content": {
      caretColor: tokens.accent,
      padding: contentPadding,
      maxWidth: isLive ? "48rem" : "none",
      margin: isLive ? "0 auto" : "0",
    },
    ".cm-line": {
      padding: isLive ? liveGeometry.linePadding : "0 2px 0 6px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: tokens.accent,
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: tokens.selection,
      },
    ".cm-activeLine": {
      backgroundColor: tokens.activeLine,
    },
    ".cm-gutters": {
      backgroundColor: tokens.surface2,
      color: tokens.textFaint,
      border: "none",
      borderRight: `1px solid ${tokens.border}`,
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(37, 99, 235, 0.06)",
      color: tokens.textMuted,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 8px",
      minWidth: "2.5em",
    },
    ...livePreviewStyles,
    ...tableContextMenuStyles,
    ".cm-line.zmd-lp-quote": {
      borderLeftColor: tokens.borderStrong,
      color: "#4b5563",
    },
    ".zmd-lp-code": {
      ...livePreviewStyles[".zmd-lp-code"],
      backgroundColor: "rgba(0, 0, 0, 0.06)",
    },
    ".zmd-lp-link": {
      ...livePreviewStyles[".zmd-lp-link"],
      color: tokens.accent,
    },
  });
}
