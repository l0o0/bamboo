/**
 * Inject polished editor styles into a Zotero main window.
 */
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
.zotero-markdown-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--zmd-border);
  background: linear-gradient(180deg, var(--zmd-surface) 0%, var(--zmd-surface-2) 100%);
  flex: 0 0 auto;
  z-index: 2;
  box-shadow: var(--zmd-shadow);
}

.zotero-markdown-toolbar-left,
.zotero-markdown-toolbar-right,
.zotero-markdown-toolbar-center {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.zotero-markdown-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 0;
  margin-right: 4px;
  color: var(--zmd-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  user-select: none;
}

.zotero-markdown-brand-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--zmd-accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: -0.02em;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.35);
}

/* Segmented Edit / Preview */
.zotero-markdown-seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--zmd-surface-2);
  border: 1px solid var(--zmd-border);
  gap: 2px;
}

.zotero-markdown-seg .zotero-markdown-btn {
  border: none;
  background: transparent;
  border-radius: 7px;
  padding: 5px 12px;
  min-width: 64px;
  font-weight: 500;
  color: var(--zmd-text-muted);
  box-shadow: none;
}

.zotero-markdown-seg .zotero-markdown-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--zmd-text);
}

.zotero-markdown-root.theme-dark .zotero-markdown-seg .zotero-markdown-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.zotero-markdown-seg .zotero-markdown-btn.active {
  background: var(--zmd-surface);
  color: var(--zmd-accent);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08), 0 0 0 1px var(--zmd-border);
  font-weight: 600;
}

.zotero-markdown-root.theme-dark .zotero-markdown-seg .zotero-markdown-btn.active {
  background: var(--zmd-surface-2);
  box-shadow: 0 0 0 1px var(--zmd-border-strong);
}

/* Format group */
.zotero-markdown-fmt {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--zmd-border);
  background: var(--zmd-surface);
}

.zotero-markdown-fmt .zotero-markdown-btn {
  min-width: 30px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  color: var(--zmd-text-muted);
  box-shadow: none;
}

.zotero-markdown-fmt .zotero-markdown-btn:hover {
  background: var(--zmd-accent-soft);
  color: var(--zmd-accent);
}

.zotero-markdown-sep {
  width: 1px;
  height: 18px;
  background: var(--zmd-border);
  margin: 0 4px;
  flex: 0 0 auto;
}

/* Generic buttons */
.zotero-markdown-btn {
  appearance: none;
  border: 1px solid var(--zmd-border);
  background: var(--zmd-surface);
  color: var(--zmd-text);
  border-radius: var(--zmd-radius-sm);
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease,
    box-shadow 0.12s ease;
}

.zotero-markdown-btn:hover {
  border-color: var(--zmd-border-strong);
  background: var(--zmd-surface-2);
}

.zotero-markdown-btn:active {
  transform: translateY(0.5px);
}

.zotero-markdown-btn-primary {
  background: var(--zmd-accent);
  border-color: var(--zmd-accent);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.25);
}

.zotero-markdown-btn-primary:hover {
  background: var(--zmd-accent-hover);
  border-color: var(--zmd-accent-hover);
  color: #fff;
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

.zotero-markdown-root.mode-edit .zotero-markdown-editor-host {
  display: flex;
}
.zotero-markdown-root.mode-edit .zotero-markdown-preview-host {
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
  border-radius: 8px;
}

/* ========== status bar ========== */
.zotero-markdown-statusbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  border-top: 1px solid var(--zmd-border);
  background: var(--zmd-surface-2);
  font-size: 11px;
  min-height: 26px;
  overflow: hidden;
  color: var(--zmd-text-muted);
}

.zotero-markdown-meta {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
  -moz-user-select: text;
  font-variant-numeric: tabular-nums;
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
