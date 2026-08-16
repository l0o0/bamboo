# Sidebar Markdown Editor Design

**Date:** 2026-08-16  
**Status:** Approved (implementation repair required before in-Zotero verification)

## Goal

在 Zotero 侧边栏（item pane）增加一个 "Markdown" 分区，像 Zotero Notes 一样就地查看与编辑选中条目的 `.md` 附件：附件列表（上）+ 编辑器（下），样式参考 Zotero Notes。

## Hosting: `Zotero.ItemPaneManager`

Zotero 8/9 官方插件 API（`zotero-types` 已含类型，本插件 manifest `strict_min_version: 9.0` 满足）。

- `Zotero.ItemPaneManager.registerSection({ paneID: "zmd-markdown", pluginID, sidenav: { icon, l10nID }, header: { icon, l10nID }, bodyXHTML?, sectionButtons?, onInit, onDestroy, onRender, onItemChange, onToggle })`
- `paneID` 必须是 `BuiltInPaneID` 之外的值（"info"/"notes"/"attachments"/… 均内置）。
- 钩子入参 `{ paneID, doc, body, item, tabType, editable, setEnabled, setSectionSummary, setSectionButtonStatus, setL10nArgs, refresh }`：`body` 是主窗口文档里的 `HTMLDivElement`，我们在此挂载编辑器 iframe。
- 注册一次即可（全局 API，各窗口自动渲染 section）；插件停用/卸载时 `unregisterSection`（传 `pluginID` 也会自动清理）。

## Content States（Notes 风格）

| 选中条目                           | 侧边栏内容                                                         |
| ---------------------------------- | ------------------------------------------------------------------ |
| 是 md 附件                         | 直接加载编辑器编辑该附件                                           |
| 普通条目且含 md 附件               | 附件列表（标题 + 摘要 + 修改时间）+ 编辑器；点击列表项切换编辑目标 |
| 其他（无 md 附件）                 | 空状态文案 + "新建 Markdown…" 主按钮                               |
| `editable === false`（群组只读等） | 编辑器 `readOnly` + 写操作按钮禁用                                 |

切换条目时：当前编辑器若有未保存修改，先强制落盘（`save.request({ force: true })`）再切换，与主窗口 Tab 关闭行为一致。

## Editor Reuse

- 复用 `createMarkdownEditor(body, { channel, doc, onChange, onSave, onResolveAsset, onPasteImage, win })`——它已是"任意 host 元素挂载 + postMessage 桥接"，与窗口无关。channel 用 `pane-${itemID}` 保证与 Tab channel 不串。
- 复用 `SaveCoordinator` + `persistMarkdownContent`：与主窗口 Tab 完全相同的单一写入路径（写文件、图片清理、标题同步、文件同步标记）。
- 图片资产：复用 `resolveImageAssetEntry` / `resolveImageAssets` / `writeImageAsset`（`images/` 模块），侧边栏直接引用，不经过 tab 专用函数。
- 主题/字号：`createMarkdownEditor` 自带 `matchMedia` / MutationObserver 深色同步；字号读同一偏好。

## Session & Conflict Policy（关键决策）

- 每个主窗口一个 `SidebarController`，缓存当前 pane 会话 `{ itemID, editor, save }`。
- **同文档双开策略（v1 推荐 A）**：
  - **A. 提示切换**：目标 item 已在本窗口主 Tab 打开时，侧边栏不创建第二个编辑器，显示提示条"该文档已在标签页中打开"+ 按钮"切换到标签页"（聚焦已有 Tab）。逻辑简单、无双写风险。
  - **B. 双端同步**：共享内容缓冲区，两端编辑实时互同步。复杂，v2 再议。
- section 关闭（onDestroy / 切换窗口 / 插件卸载）时：flush + `editor.destroy()`。

## Toolbar & Header

- section header：
  - `setSectionSummary` 显示保存状态（已保存 / 未保存 / 保存失败）。
  - `sectionButtons`：新建 Markdown（在当前选中条目下创建并打开）、移入回收站（当前编辑附件）。
- body 顶部紧凑工具条（约 32px，沿用 `styles.ts` 的 toolbar 样式族 + container query 响应式）：
  - 模式切换 Live / Source（复用 `iconLive` / `iconSource`）。
- 保存：防抖自动保存 + Ctrl/Cmd+S（iframe `save` 消息 → force save）。

## Styling（参考 Zotero Notes）

- 附件列表卡片：标题（粗体）+ 摘要（muted，单/双行省略），hover / 选中高亮；颜色用 Zotero 主题变量（`--fill-*` / `--border-*`）叠加现有 `--zmd-*` tokens，深浅色自动。
- 编辑器区域：使用明确的响应式高度，iframe 填满该区域，不依赖 item pane 提供固定剩余高度。
- 空状态：居中、muted、主按钮。
- 侧边栏宽度窄：编辑器单栏文档流自然收缩（`48rem` max-width 在窄容器下退化为自适应）。

## Files

- **new** `src/modules/markdown/sidebar.ts`：`SidebarController` + `registerSidebarSection()` / `unregisterSidebarSection()`。
- **mod** `src/hooks.ts`：onStartup 注册 section；onMainWindowUnload / 停用清理。
- **mod**（尽量小）把 tab.ts 里可共享的辅助（图片资产解析入口、附件列表摘要生成）抽出或直接复用 `images/` 模块。
- **mod** `addon/locale/en-US.ftl`、`zh-CN.ftl`：新增 l10n 字符串。
- **mod** 图标：优先复用现有 favicon / `icons.ts`；如需要新增 markdown 文档图标。

## Verification

- 在 Zotero 9/10 实测（`pnpm start`）：section 渲染、`onItemChange` 切换、保存/自动保存、只读群组、深色模式、与主 Tab 冲突策略、卸载清理。
- 单测：可抽纯逻辑（列表摘要生成、状态机转换、channel 命名）加单测。

## Open Decisions（已确认）

1. 布局：**列表 + 编辑器双区**（Notes 风格）。
2. 同文档 Tab + 侧边栏冲突：**A 提示切换**（不创建第二编辑器，显示提示 + "切换到标签页"）。
3. 只读 Preview：**不做**——侧边栏只提供 Live / Source 切换。
4. 图标：**复用 favicon** 作为 sidenav / header 图标。

## Lifecycle Repair

The sidebar content has three explicit body states: `editor`, `hint`, and
`empty`. Visibility is derived from the state instead of calling a blanket
`hideAll()` before every asynchronous editor operation.

- `editor`: show the editor host. Also keep the attachment list visible when
  the selected Zotero item is a regular parent item with Markdown attachments.
- `hint`: show the "already open in a tab" message. Preserve the attachment
  list for a regular parent item so another Markdown attachment remains
  selectable.
- `empty`: show only the relevant empty-state message and action.

Repeated `onRender`, `onItemChange`, and `onToggle` calls for the same Markdown
attachment reuse the existing iframe and restore the planned visible state.
They must not hide the editor and then return early merely because the editor
already exists. Switching to a different attachment still flushes and destroys
the previous editor before creating the next one.

## Sidebar Geometry Repair

Zotero item-pane sections are content-sized and do not guarantee a definite
parent height. The sidebar therefore must not depend on `height: 100%` plus a
zero-height flex child.

- The sidebar root uses natural block height.
- The editor host has a stable responsive block size, clamped between roughly
  `320px` and `600px`, so its absolutely positioned iframe always has a
  measurable containing block.
- The item pane remains responsible for outer scrolling; the CodeMirror iframe
  remains responsible for editor scrolling.
- Narrow sidebar widths continue to use the existing single-column editor
  layout without horizontal overflow.

## Repair Verification

- Re-rendering the same direct Markdown attachment leaves its editor visible
  and reuses the existing editor session.
- Re-rendering a regular item keeps both its attachment list and selected
  editor visible.
- A tab conflict shows the hint while preserving the parent attachment list.
- Changing attachments still flushes the previous editor before switching.
- The editor host has a non-zero height before the iframe is created.
- Pure state-planning tests cover direct attachments, parent-item lists,
  repeated renders, tab conflicts, and empty states.
