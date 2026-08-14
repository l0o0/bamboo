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
  max-width: 44rem;
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
.zotero-markdown-root {
  --zmd-bg: #fbfbfc;
  --zmd-surface: #ffffff;
  --zmd-surface-2: #f3f4f6;
  --zmd-border: #e5e7eb;
  --zmd-border-strong: #d1d5db;
  --zmd-text: #111827;
  --zmd-text-muted: #6b7280;
  --zmd-text-faint: #9ca3af;
  --zmd-accent: #2563eb;
  --zmd-accent-soft: rgba(37, 99, 235, 0.12);
  --zmd-accent-hover: #1d4ed8;
  --zmd-success: #059669;
  --zmd-success-soft: rgba(5, 150, 105, 0.12);
  --zmd-warn: #d97706;
  --zmd-danger: #dc2626;
  --zmd-radius: 8px;
  --zmd-radius-sm: 6px;
  --zmd-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  --zmd-font-ui: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

.zotero-markdown-root.theme-dark {
  --zmd-bg: #12141a;
  --zmd-surface: #1a1d24;
  --zmd-surface-2: #22262f;
  --zmd-border: #2e3440;
  --zmd-border-strong: #3d4452;
  --zmd-text: #e8eaed;
  --zmd-text-muted: #9aa3b2;
  --zmd-text-faint: #6b7280;
  --zmd-accent: #60a5fa;
  --zmd-accent-soft: rgba(96, 165, 250, 0.16);
  --zmd-accent-hover: #93c5fd;
  --zmd-success: #34d399;
  --zmd-success-soft: rgba(52, 211, 153, 0.14);
  --zmd-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

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

.zotero-markdown-fmt {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.zotero-markdown-fmt .zotero-markdown-btn {
  width: var(--zmd-toolbar-control-size);
}

.zotero-markdown-table-control {
  position: relative;
  display: inline-flex;
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
  left: calc(100% - var(--zmd-toolbar-control-size));
  z-index: 10;
  width: 220px;
  padding: 6px;
  border: 1px solid var(--zmd-border);
  border-radius: 8px;
  background: var(--zmd-surface);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.14);
}

.zotero-markdown-more-menu[hidden],
.zotero-markdown-mode-menu[hidden] {
  display: none;
}

.zotero-markdown-more-menu-item {
  appearance: none;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  padding: 0 9px;
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
  color: var(--zmd-text-muted);
  font-size: 11px;
}

.zotero-markdown-more-menu-separator {
  height: 1px;
  margin: 6px 4px;
  background: var(--zmd-border);
}

.zotero-markdown-mode-menu {
  position: absolute;
  top: 86px;
  left: calc(100% - 4px);
  width: 132px;
  padding: 6px;
  border: 1px solid var(--zmd-border);
  border-radius: 8px;
  background: var(--zmd-surface);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.14);
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
  height: calc(var(--zmd-toolbar-control-size) * 0.55);
  background: var(--zmd-border);
  margin: 0 10px;
  flex: 0 0 auto;
  align-self: center;
}

/* Generic buttons */
.zotero-markdown-btn {
  appearance: none;
  width: var(--zmd-toolbar-control-size);
  height: var(--zmd-toolbar-control-size);
  border: none;
  background: transparent;
  color: var(--zmd-text-muted);
  border-radius: 7px;
  padding: 0;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.zotero-markdown-btn-save,
.zotero-markdown-more {
  width: var(--zmd-toolbar-control-size);
  height: var(--zmd-toolbar-control-size);
}

.zotero-markdown-btn:hover {
  background: var(--zmd-surface-2);
  color: var(--zmd-text);
}

.zotero-markdown-btn:active {
  transform: translateY(0.5px);
}

.zotero-markdown-btn-primary {
  color: var(--zmd-text);
}

.zotero-markdown-btn-primary:hover {
  background: var(--zmd-surface-2);
  color: var(--zmd-text);
}

/* Status pill in toolbar */
.zotero-markdown-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--zmd-text-muted);
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--zmd-surface-2);
  border: 1px solid var(--zmd-border);
  max-width: 12em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.zotero-markdown-status::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zmd-text-faint);
  flex: 0 0 auto;
}

.zotero-markdown-status.is-dirty {
  color: var(--zmd-warn);
  background: rgba(217, 119, 6, 0.1);
  border-color: rgba(217, 119, 6, 0.25);
}
.zotero-markdown-status.is-dirty::before {
  background: var(--zmd-warn);
}

.zotero-markdown-status.is-saved {
  color: var(--zmd-success);
  background: var(--zmd-success-soft);
  border-color: rgba(5, 150, 105, 0.25);
}
.zotero-markdown-status.is-saved::before {
  background: var(--zmd-success);
}

.zotero-markdown-status.is-error {
  color: var(--zmd-danger);
  background: rgba(220, 38, 38, 0.1);
  border-color: rgba(220, 38, 38, 0.25);
}
.zotero-markdown-status.is-error::before {
  background: var(--zmd-danger);
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

/* ========== preview prose ========== */
.zotero-markdown-preview-host {
  display: none;
  overflow: auto;
  padding: 28px 32px 40px;
  box-sizing: border-box;
  font-size: 15px;
  line-height: 1.7;
  background: var(--zmd-bg);
  color: var(--zmd-text);
}

.zotero-markdown-preview-inner {
  max-width: 46em;
  margin: 0 auto;
  padding: 28px 32px;
  background: var(--zmd-surface);
  border: 1px solid var(--zmd-border);
  border-radius: 12px;
  box-shadow: var(--zmd-shadow);
}

.zotero-markdown-preview-empty {
  opacity: 0.55;
  text-align: center;
  padding: 3em 1em;
}

.zotero-markdown-preview-host h1,
.zotero-markdown-preview-host h2,
.zotero-markdown-preview-host h3,
.zotero-markdown-preview-host h4 {
  margin-top: 1.4em;
  margin-bottom: 0.45em;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--zmd-text);
}

.zotero-markdown-preview-host h1 {
  font-size: 1.75em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-host h2 {
  font-size: 1.35em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--zmd-border);
}
.zotero-markdown-preview-host h3 {
  font-size: 1.15em;
}

.zotero-markdown-preview-host p {
  margin: 0.75em 0;
}

.zotero-markdown-preview-host a {
  color: var(--zmd-accent);
  text-decoration: none;
}
.zotero-markdown-preview-host a:hover {
  text-decoration: underline;
}

.zotero-markdown-preview-host ul,
.zotero-markdown-preview-host ol {
  padding-left: 1.4em;
  margin: 0.6em 0;
}

.zotero-markdown-preview-host li {
  margin: 0.25em 0;
}

.zotero-markdown-preview-host pre {
  background: var(--zmd-surface-2);
  border: 1px solid var(--zmd-border);
  padding: 12px 14px;
  border-radius: 8px;
  overflow: auto;
  font-size: 0.9em;
  line-height: 1.5;
}

.zotero-markdown-preview-host code {
  font-family: ui-monospace, "Sarasa Mono SC", SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}

.zotero-markdown-preview-host :not(pre) > code {
  background: var(--zmd-accent-soft);
  color: var(--zmd-accent-hover);
  padding: 0.12em 0.4em;
  border-radius: 4px;
}

.zotero-markdown-preview-host blockquote {
  margin: 1em 0;
  padding: 0.2em 0 0.2em 1em;
  border-left: 3px solid var(--zmd-accent);
  color: var(--zmd-text-muted);
  background: var(--zmd-accent-soft);
  border-radius: 0 6px 6px 0;
}

.zotero-markdown-preview-host hr {
  border: none;
  border-top: 1px solid var(--zmd-border);
  margin: 1.6em 0;
}

.zotero-markdown-preview-host table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 0.95em;
}

.zotero-markdown-preview-host th,
.zotero-markdown-preview-host td {
  border: 1px solid var(--zmd-border);
  padding: 8px 12px;
}

.zotero-markdown-preview-host th {
  background: var(--zmd-surface-2);
  font-weight: 600;
}

.zotero-markdown-preview-host img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
}

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
