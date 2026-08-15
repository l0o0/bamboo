import { previewDocumentCss } from "./preview";
import { THEME_TOKENS, themeTokenCss } from "./theme-tokens";

/**
 * Inject polished editor styles into a Zotero main window.
 */
export function responsiveToolbarSizingCSS(): string {
  return `
.zotero-markdown-toolbar {
  container: zmd-toolbar / inline-size;
  --zmd-toolbar-icon-size: 18px;
  --zmd-toolbar-control-size: 40px;
}

@container zmd-toolbar (min-width: 1050px) {
  .zotero-markdown-toolbar-inner {
    --zmd-toolbar-icon-size: 20px;
    --zmd-toolbar-control-size: 44px;
  }
}

@container zmd-toolbar (max-width: 760px) {
  .zotero-markdown-toolbar-inner {
    --zmd-toolbar-icon-size: 16px;
    --zmd-toolbar-control-size: 36px;
  }
}`;
}

export function toolbarWidthAlignmentCSS(): string {
  return `
.zotero-markdown-toolbar {
  padding: 4px 30px 4px 34px;
}

.zotero-markdown-toolbar-inner {
  width: 100%;
  max-width: 60rem;
}`;
}

export function injectMarkdownStyles(win: Window) {
  const doc = win.document;
  const id = `${addon.data.config.addonRef}-markdown-styles`;
  // Always refresh styles during development so UI tweaks apply without restart
  const existing = doc.getElementById(id);
  if (existing) existing.remove();

  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
/* ========== tokens ========== */
${themeTokenCss(".zotero-markdown-root", THEME_TOKENS.light)}

${themeTokenCss(".zotero-markdown-root.theme-dark", THEME_TOKENS.dark)}

/* XUL tab-content positioning */
.zotero-markdown-tab-content,
tab-content.zotero-markdown-tab-content {
  position: relative !important;
  height: 100% !important;
  width: 100% !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.zotero-markdown-root {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--zmd-bg);
  color: var(--zmd-text);
  font-family: var(--zmd-font-ui);
  box-sizing: border-box;
  overflow: hidden;
}

/* ========== toolbar ========== */
${responsiveToolbarSizingCSS()}

.zotero-markdown-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--zmd-border);
  background: linear-gradient(180deg, var(--zmd-surface) 0%, var(--zmd-surface-2) 100%);
  flex: 0 0 auto;
  z-index: 2;
  box-shadow: var(--zmd-shadow);
}

.zotero-markdown-toolbar-inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
}

${toolbarWidthAlignmentCSS()}

.zotero-markdown-fmt,
.zotero-markdown-table-control {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.zotero-markdown-table-control {
  position: relative;
}

.zotero-markdown-table-picker {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 12;
  width: 190px;
  padding: 10px;
  border: 1px solid var(--zmd-border);
  border-radius: 8px;
  background: var(--zmd-surface);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.14);
}

.zotero-markdown-table-picker[hidden] {
  display: none;
}

.zotero-markdown-table-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.zotero-markdown-table-cell {
  appearance: none;
  aspect-ratio: 1;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--zmd-border-strong);
  border-radius: 2px;
  background: var(--zmd-surface-2);
  cursor: pointer;
}

.zotero-markdown-table-cell.is-selected {
  border-color: var(--zmd-accent);
  background: var(--zmd-accent-soft);
}

.zotero-markdown-table-size {
  min-height: 18px;
  margin-top: 8px;
  color: var(--zmd-text-muted);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.zotero-markdown-toolbar-spacer {
  flex: 1 1 auto;
}

.zotero-markdown-more-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: auto;
  z-index: 10;
  box-sizing: border-box;
  width: max-content;
  min-width: 12rem;
  max-width: min(16rem, calc(100% - 8px));
  padding: 4px;
  border: 1px solid var(--zmd-border);
  border-radius: 8px;
  background: var(--zmd-surface);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.14);
}

.zotero-markdown-more-menu[hidden],
.zotero-markdown-mode-submenu[hidden] {
  display: none;
}

.zotero-markdown-more-menu-item {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--zmd-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.zotero-markdown-more-menu-item:hover {
  background: var(--zmd-surface-2);
}

.zotero-markdown-more-menu-shortcut,
.zotero-markdown-more-menu-chevron {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--zmd-text-muted);
  font-size: 11px;
}

.zotero-markdown-more-menu-chevron {
  display: inline-block;
  transition: transform 0.12s ease;
}

.zotero-markdown-more-menu-item[aria-expanded="true"] .zotero-markdown-more-menu-chevron {
  transform: rotate(90deg);
}

.zotero-markdown-more-menu-separator {
  height: 1px;
  margin: 6px 4px;
  background: var(--zmd-border);
}

.zotero-markdown-mode-submenu {
  display: flex;
  flex-direction: column;
  padding: 0 0 2px 8px;
}

.zotero-markdown-mode-submenu .zotero-markdown-more-menu-item {
  position: relative;
  min-height: 28px;
  padding-left: 22px;
}

.zotero-markdown-mode-check {
  position: absolute;
  left: 8px;
  width: 12px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: var(--zmd-accent);
  text-align: center;
}

.zotero-markdown-mode-submenu .zotero-markdown-more-menu-item.is-checked .zotero-markdown-mode-check::before {
  content: "✓";
}

/* Icon + label layout */
.zmd-btn-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  line-height: 1;
  pointer-events: none; /* clicks hit the button, not SVG children */
}

.zmd-btn-inner-icon {
  gap: 0;
}

.zmd-btn-label {
  font-size: 12px;
  font-weight: inherit;
  letter-spacing: 0.01em;
}

.zmd-icon {
  display: block;
  width: var(--zmd-toolbar-icon-size);
  height: var(--zmd-toolbar-icon-size);
  flex: 0 0 auto;
  stroke: currentColor;
}

.zotero-markdown-sep {
  width: 1px;
  min-width: 1px;
  height: calc(var(--zmd-toolbar-control-size) * 0.55);
  background: var(--zmd-border);
  margin: 0 10px;
  flex: 0 0 auto;
  align-self: center;
}

/* Generic buttons — one treatment for save, history, and format icons */
.zotero-markdown-btn,
.zotero-markdown-btn-save,
.zotero-markdown-more {
  appearance: none;
  -moz-appearance: none;
  box-sizing: border-box;
  flex: 0 0 var(--zmd-toolbar-control-size);
  width: var(--zmd-toolbar-control-size);
  min-width: var(--zmd-toolbar-control-size);
  height: var(--zmd-toolbar-control-size);
  border: none;
  background: transparent;
  box-shadow: none;
  filter: none;
  color: var(--zmd-text-muted);
  border-radius: 7px;
  padding: 0;
  font-size: 12px;
  font-family: inherit;
  font-weight: 400;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.zotero-markdown-btn:hover,
.zotero-markdown-btn-save:hover,
.zotero-markdown-more:hover {
  background: var(--zmd-surface-2);
  color: var(--zmd-text);
  box-shadow: none;
}

.zotero-markdown-btn:active,
.zotero-markdown-btn-save:active,
.zotero-markdown-more:active {
  transform: translateY(0.5px);
  box-shadow: none;
}

/* ========== body ========== */
.zotero-markdown-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--zmd-surface);
}

.zotero-markdown-editor-host,
.zotero-markdown-preview-host {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  min-height: 0;
  overflow: hidden;
}

.zotero-markdown-editor-host {
  display: flex;
  flex-direction: column;
}

.zotero-markdown-root.mode-edit .zotero-markdown-editor-host,
.zotero-markdown-root.mode-live .zotero-markdown-editor-host,
.zotero-markdown-root.mode-source .zotero-markdown-editor-host {
  display: flex;
}
.zotero-markdown-root.mode-edit .zotero-markdown-preview-host,
.zotero-markdown-root.mode-live .zotero-markdown-preview-host,
.zotero-markdown-root.mode-source .zotero-markdown-preview-host {
  display: none;
}
.zotero-markdown-root.mode-preview .zotero-markdown-editor-host {
  display: none;
}
.zotero-markdown-root.mode-preview .zotero-markdown-preview-host {
  display: block;
  overflow: auto;
}

/* ========== editor (iframe + CodeMirror) ========== */
.zmd-editor-wrap {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--zmd-surface);
  box-sizing: border-box;
}

.zmd-codemirror-iframe {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: none;
  display: block;
  background: var(--zmd-surface);
}

/* legacy textarea (kept for emergency fallback; unused by default) */
.zmd-gutter {
  display: none;
}

.zmd-textarea {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 14px 18px;
  border: none;
  outline: none;
  resize: none;
  box-sizing: border-box;
  background: var(--zmd-surface);
  color: var(--zmd-text);
  caret-color: var(--zmd-accent);
  white-space: pre;
  overflow: auto;
  tab-size: 4;
}

/* ========== preview (read-only export surface) ========== */
.zotero-markdown-preview-host {
  display: none;
  overflow: auto;
  padding: 0;
  box-sizing: border-box;
}

.zotero-markdown-preview-page {
  min-height: 100%;
  padding: 16px 24px 40px;
  box-sizing: border-box;
}

.zotero-markdown-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 46em;
  margin: 0 auto 16px;
}

.zotero-markdown-preview-bar-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--zmd-text-muted);
  font-size: 12px;
}

.zotero-markdown-preview-bar-copy strong {
  color: var(--zmd-text);
  font-size: 13px;
}

.zotero-markdown-preview-back {
  appearance: none;
  border: 1px solid var(--zmd-border);
  background: var(--zmd-surface);
  color: var(--zmd-text);
  border-radius: 7px;
  min-height: 32px;
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.zotero-markdown-preview-back:hover {
  background: var(--zmd-surface-2);
}

.zotero-markdown-root.mode-preview .zotero-markdown-fmt,
.zotero-markdown-root.mode-preview [data-action="undo"],
.zotero-markdown-root.mode-preview [data-action="redo"],
.zotero-markdown-root.mode-preview [data-action="image"],
.zotero-markdown-root.mode-preview [data-action="table"] {
  opacity: 0.38;
  pointer-events: none;
}

${previewDocumentCss()}

.zotero-markdown-image-missing {
  display: block;
  padding: 12px 14px;
  border: 1px dashed var(--zmd-border);
  border-radius: 4px;
  color: var(--zmd-text-muted);
  font-size: 13px;
}

/* ========== status bar ========== */
.zotero-markdown-statusbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 28px;
  border-top: 1px solid var(--zmd-border);
  background: var(--zmd-surface-2);
  font-size: 11px;
  min-height: 26px;
  overflow: hidden;
  color: var(--zmd-text-muted);
}

.zotero-markdown-meta {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.zotero-markdown-save-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.zotero-markdown-save-status::before {
  content: "✓";
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.zotero-markdown-save-status.is-saved {
  color: var(--zmd-text-muted);
}

.zotero-markdown-save-status.is-saved::before {
  color: var(--zmd-success);
}

.zotero-markdown-save-status.is-dirty {
  color: var(--zmd-warn);
}

.zotero-markdown-save-status.is-dirty::before {
  content: "•";
  font-size: 17px;
}

.zotero-markdown-save-status.is-error {
  color: var(--zmd-danger);
}

.zotero-markdown-save-status.is-error::before {
  content: "!";
}

.zotero-markdown-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  background: var(--zmd-surface);
  border: 1px solid var(--zmd-border);
  color: var(--zmd-text-muted);
  flex: 0 0 auto;
}

.zotero-markdown-chip.is-stored {
  color: var(--zmd-accent);
  border-color: rgba(37, 99, 235, 0.25);
  background: var(--zmd-accent-soft);
}

.zotero-markdown-chip.is-linked {
  color: var(--zmd-success);
  border-color: rgba(5, 150, 105, 0.25);
  background: var(--zmd-success-soft);
}
`;
  doc.documentElement?.appendChild(style);
}
