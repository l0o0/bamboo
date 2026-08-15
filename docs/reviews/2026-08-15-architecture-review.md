# Zotero Markdown 架构审查报告

> 日期：2026-08-15
> 范围：`DESIGN.md`、`docs/` 下的设计/实施方案、`src/` 当前实现
> 结论：架构方向正确，但当前更接近“功能单体的原型”；下一步应从“功能正确”升级为“会话可持久、可并发、可测试”。

---

## 1. 总体评价

做得对的地方：

- `chrome://` iframe + CodeMirror 6 解决了 Zotero chrome 文档中 CM 测量不稳定的问题。
- CodeMirror 始终是文档唯一权威：表格单元格编辑只是把 `contenteditable` 的输入转成 CM transaction。
- 纯函数 planner（表格操作、图片引用、frontmatter）可测试性好。
- 图片 sidecar 方案（`storage/<mdKey>/assets/`）不污染条目列表。
- 设计与实施方案文档化程度高，决策记录清晰。

主要问题：

- 保存流水线存在竞态，有数据丢失窗口。
- 会话注册表未按窗口隔离，多窗口下有泄漏和丢会话风险。
- 每次按键全量回传文档 + 全文档重建 Live Preview 装饰，大文件性能堪忧。
- 协议为单向 fire-and-forget，缺少版本、确认和恢复机制。
- Live / Preview / 表格分别使用三套 Markdown 解析现实，长期会漂移。
- `tab.ts`（1444 行）和 `bootstrap.ts`（817 行）承担了过多职责。

---

## 2. 建议的目标分层

```
Zotero 主窗口 Shell（toolbar / status / preview）
   └─ SessionView（typed DOM refs）
SessionRegistry（windowID → itemID → Session）
   └─ SaveCoordinator（revision + 单写队列 + flush）
      ├─ FileStore（读写、mtime/冲突检测）
      ├─ TitleSyncService
      └─ ImageAssetStore（写盘、缓存、GC）
EditorHandle（协议 client，shadow value cache）
   ║ postMessage（版本化 RPC）
   ▼
iframe CM6（只做 view：decoration、widget、命令）
   └─ LivePreview / Table plugins（行级 parse cache）
```

依赖规则（建议写进 `docs/architecture.md`）：

- `editor-protocol.ts`、Markdown 解析模型保持**纯模块**，不 import Zotero/DOM。
- `src/editor/` 只碰 DOM + CodeMirror，**禁止**直接访问 Zotero API。
- Zotero API（`Zotero.File`、`Zotero_Tabs`、`MenuManager`、私有 `_getTab`）全部收敛到一个 platform adapter 后面。
- 所有文件写操作必须经过同一个 SaveCoordinator，UI 不直接写盘。

---

## 3. P0：数据正确性优先

### 3.1 保存流水线存在竞态，重构为 revision + 单写队列

`tab.ts` 的保存状态机（`dirty/saving/saveFailed/pendingExplicitSave/pendingImageCleanup/pendingImageSave/applyingTitleSync`）过于脆弱，存在真实的数据丢失窗口：

- `saveSession()` 开头 `if (session.saving) return;` 会**直接丢弃**保存请求。
- 写成功后无条件 `session.dirty = false`。若保存进行中用户继续输入，输入产生的 dirty 会被这次完成的旧保存清零；随后到期的 autosave timer 看到 `dirty=false` 直接返回，**最后一段输入永远不会自动保存**。
- `closeSession` 的 flush 同样会被 `saving=true` 短路，然后马上 `editor.destroy()`，无法保证最终版本落盘。

建议引入：

```ts
interface SessionState {
  currentRev: number; // 每次 onChange 递增
  savedRev: number; // 已写盘版本
  forceSave: boolean; // Ctrl+S / close
}
```

`SaveCoordinator` 内部是一条 async 写队列：autosave / explicit save / close flush 都只是“入队并携带目标 revision”；写盘前从 editor 拿最新快照；完成后 `savedRev = writtenRev`，若期间又有新 rev 则自动再排一次。这样不需要任何 boolean 标志，`flush()` 保证队列排空。

外部文件修改检测（mtime/hash，README 已列入计划）也应放在这一层，避免“打开后外部改过、本插件又覆盖回去”。

### 3.2 会话注册表按窗口隔离

`itemToTab: Map<number, string>` 是全局的。在窗口 A 打开某 md 后，在窗口 B 再次打开同一 item 时，现有代码在 B 找不到 tabID，会 `sessions.delete(existingTabID)` 并重新建 session——**A 窗口的 session 被移出注册表却仍然活着**（editor、timer、监听器都在），关闭时无法 flush。

另外 `onMainWindowUnload` 只清理 context menu，不清理该窗口的 session。

建议改为 `Map<windowID, Map<itemID, tabID>>`，窗口 unload 时只 flush 自己的 sessions。

### 3.3 用 typed view refs 替代字符串查询 + `as any`

`tab.ts:701` 查询 `.zotero-markdown-status`，但 DOM 里没有这个类（只有 `.zotero-markdown-statusbar`），因此 `setStatus()` 实际是 no-op；状态文案靠 `(session as any)._saveStatusEl` 这种绕过类型系统的补救。`_btnLive/_btnSource/_btnPreview` 也是永远 undefined 的残留。

建议建一个 `SessionView` 对象，在 `mountEditorUI` 时一次性解析并持有所有 DOM 引用，session 不再散落 `any` 属性。

---

## 4. P1：性能与协议

### 4.1 不要每次按键都把整个文档 postMessage 回父侧

`bootstrap.ts` 的 `updateListener` 在每次 `docChanged` 时发送 `{ value: 全文, stats: 全文统计 }`，`computeStats` 每次都是 O(n) 正则；父侧 autosave/onChange 也基于全文。对长文档这是每次击键 O(n) 复制 + structured clone，与设计目标里的“大文件体验”矛盾。

建议协议分层：

- 高频：只发 `{ rev, docChanged: true }`（甚至序列化 CM `ChangeSet`）。
- 低频：全文快照 throttled（例如 150–300ms）或由父侧 `requestSnapshot` 拉取。
- `getValue()` 继续同步返回缓存，但 `save/flush` 先 await 一次 `snapshot` 请求，保证写盘的是最终版本。
- stats 单独 debounce，不要在每次 change 时算全文。

### 4.2 Live Preview 装饰器全文档重建，需要缓存化

`plugin.ts` 的 `buildDecorations` 每次 `docChanged/selectionSet/viewportChanged` 都：

- 遍历 `1..state.doc.lines` 全部行。
- 调用 `state.doc.toString()` 两次（frontmatter + fenced code）。
- 全量 `liveTableRows(state)` 再走一遍 syntax tree。
- 每个表格 cell widget 重建 DOM。

这是 O(document) per keystroke。建议：

- 用 `update.changes.iterChangedRanges()` 只重算受影响行，维护按行号 key 的 parse cache（行文本没变就直接复用）。
- “active line” 是 selection 驱动的，单独维护一组 line decoration，selection 移动时只切换相关行。
- 表格只对与 changed ranges 相交的 table 重算。
- frontmatter/fence 状态做成增量行状态，不要每次 `toString()`。

### 4.3 图片解析改为按需 + 缓存，而不是每次全量 base64

现在每次输入后 250ms 就 `resolveImageAssets()`，把所有引用图读成 data URL 再整个 `setImageAssets` 推给 iframe；图片一多，内存和 postMessage 开销都会失控。

建议 `ImageAssetStore`：

- 按 `path + mtime + size` 缓存。
- iframe 对**视口内**图片发 `resolveAsset { requestId }`，父侧回 `assetResolved`。
- `setImageAssets` 只做失效通知 / 缩略图预取。
- `imageDebug` 目前无条件 `console.info + postMessage`，应挂 debug pref / dev env 开关。

图片相关小问题：

- `bootstrap.ts` paste/drop 在 `file.arrayBuffer()` 前不查 `file.size`，15MB 限制在父侧才生效。
- `service.ts` 的 `importExternalImages` 用 `next.replace(原始子串, ...)` 替换“第一次出现”，而不是按偏移 `slice(0, from) + insert + slice(to)`，相同图片语法出现两次时会改错位置。

---

## 5. P2：协议健壮性与领域一致性

### 5.1 协议要版本化、可确认、可恢复

现在的 postMessage 是单向 fire-and-forget，双方都用 `targetOrigin: "*"`，channel 是可猜测的 `${tabID}:${itemID}`。建议：

- envelope 加 `v: 1`，`ready/init` 做显式握手（带重试/超时），处理 iframe 加载失败后的重建。
- 为 paste image、snapshot 等异步操作加 `requestId` + ack/error 响应；这样插入图片时还能带上“请求发起时的选区位置”，避免用户粘贴后光标已移动、图片插到错误位置。
- parent 校验 `event.origin`，child 校验消息确实来自 `window.parent` 的 chrome origin；channel 用每 session 随机 nonce，而不是可枚举字符串。
- 当前 `sendOrQueue` 里 de-dup 同类型命令的策略需要显式语义化（哪些覆盖、哪些必须顺序执行），否则以后加命令容易踩坑。

### 5.2 收敛 Markdown 解析器：现在是三套语法现实

- Live Preview：手写正则（heading/list/quote/em/link/image）。
- 表格：Lezer GFM syntax tree。
- Preview：markdown-it GFM。

三者对同一文档的判断会逐渐漂移（image title、嵌套 bracket、转义 pipe 等）。建议：

- 抽一个纯 `markdown-syntax` 模块作为 Live Preview 和图片引用提取的**唯一 facade**，内部结构信息优先用已有的 Lezer GFM（依赖已在 bundle 里），行内再做保守正则兜底。
- markdown-it 只负责最终 HTML 输出。
- 建一个 GFM 语料 golden corpus，做 differential test：同一 corpus 下 Live / Preview / 表格解析的结果必须一致或明确声明 fallback。

### 5.3 拆分 `tab.ts` 和 `bootstrap.ts`

`tab.ts` 同时是 UI 构造器、session 注册表、autosave、标题同步、图片管线、菜单和表格选择器。建议至少拆成：

- `session.ts`：SessionRegistry + SaveCoordinator。
- `toolbar.ts`：toolbar 描述表（action → {icon, enabled, run}）+ 渲染。
- `preview.ts` / `title-sync.ts` / `images/`。
- `tab.ts` 只做 composition。

`bootstrap.ts` 里 module 级可变状态（`view/currentMode/activeTableCell/tableContextMenu/...`）应封装成一个 `EditorRuntime` 实例；`bindImageDoubleClick` 和 `domEventHandlers` 里的 dblclick 逻辑现在重复了两遍，也应合并。

### 5.4 主题与 token 消除双源

`styles.ts`（父 shell）定义了一套 `--zmd-*` token，`theme.ts`（iframe）又硬编码了一套颜色，两边主题监听也是两套 matchMedia + MutationObserver。

建议共享 token 常量/生成器同时进两个 bundle，并让一个 ThemeService 统一发布主题变更；否则以后每加一个颜色都要改两处，DESIGN.md 的 token 约束也无法自动校验。

### 5.5 Preview 模式要尽快做产品裁决

Live / Source / Preview 三套心智并存，Preview 又带独立 markdown-it 渲染 + 独立图片水合路径。设计文档自己说了 L2/L3 要评估合并。

架构上建议明确：Preview 要么降级为“导出/只读视图”（复用 ImageAssetStore，不维护编辑状态），要么最终并入 Live 的只读态，避免三套模式长期都要维护。

---

## 6. 工程化与验证

- **测试分层**：现有测试覆盖了纯 planner，很好。下一步给 `FileStore`/`ImageAssetStore` 注入 fake IOUtils，给协议加 fake `MessageChannel`，让 SaveCoordinator 的竞态可测；CI 里 `test` job 目前被注释掉，值得用 Zotero 二进制跑一个最小 open/edit/save smoke test。
- **表格操作加 property test**：对序列化/反序列化、边界操作跑随机组合，这类纯函数最容易用 property test 锁住不变量（表头不可删、至少一列、单事务 undo）。
- **补一份 `docs/architecture.md`**：现在有很好的 design/spec，但缺一张“模块边界 + 依赖规则 + 数据流”的架构总图；同时把已过时的 plan 状态更新掉。
- **清理死代码**：`imageInsertTemplate`、`.zmd-textarea` legacy fallback、未使用的 `_btnLive/_btnSource/_btnPreview`、永远不命中的 `.zotero-markdown-status` CSS。
- **i18n 收口**：表格菜单、tooltip、保存状态现在硬编码中文，和菜单用 FTL 的做法不一致，后续应全部走 Fluent。
- **对外 API**：`addon.api` 目前是空对象。既然定位是与 Better Notes 互补，可以借这个口暴露稳定的 `openMarkdown / createMarkdown` API（带版本），避免其他插件直接依赖内部函数。

---

## 7. 执行顺序建议

不要推倒重写，按依赖顺序渐进推进：

1. **先做 P0**：SaveCoordinator + 按窗口的 SessionRegistry + typed SessionView（数据安全和多窗口正确性的地基）。
2. **再做 P1**：协议快照/增量缓存 + Live Preview 增量装饰 + 图片按需解析（性能）。
3. **最后做 P2**：解析器收敛、token 统一、模块拆分（长期可维护性）。

当前设计文档质量足以支撑这条渐进路线。

---

## 8. 复核更新（实现后二次复核）

> 复核日期：2026-08-15
> 复核范围：本报告提出后的工作区改动，包括 SaveCoordinator、SessionRegistry、协议改造、Live Preview 缓存、表格 cell 编辑调整、Preview/导出、theme tokens 等。

### 8.1 验证结果

| 检查                     | 结果                                       |
| ------------------------ | ------------------------------------------ |
| `pnpm exec tsc --noEmit` | ✅ 通过                                    |
| `pnpm run build`         | ✅ 通过                                    |
| `pnpm run test:unit`     | ✅ 98 个测试全部通过                       |
| `pnpm exec eslint .`     | ✅ 通过                                    |
| `pnpm run lint:check`    | ❌ Prettier 有 7 个文件未格式化，CI 会失败 |

总体判断：**P0 保存模型、会话隔离、typed view refs 完成质量较好；但表格 cell 编辑这一核心问题仍未真正解决，并发现一个新的 P0 集成 bug。**

### 8.2 与首版报告对照

| 报告项                                   | 状态 | 复核结论                                          |
| ---------------------------------------- | ---- | ------------------------------------------------- |
| SaveCoordinator + revision 队列          | ✅   | 实现和单测正确                                    |
| 会话按窗口隔离                           | ✅   | 实现正确，有测试                                  |
| typed SessionView                        | ✅   | 已落地                                            |
| 增量 change + snapshot                   | ✅   | 正常路径正确；`setValue` 集成有 P0 bug            |
| 图片按需解析                             | 🟡   | 单图请求 + mtime/size 缓存已做，但 refresh 仍批量 |
| 图片 offset 替换 / 大小预检 / debug 开关 | ✅   | 已修                                              |
| Theme tokens 统一                        | ✅   | 已修并有测试                                      |
| Preview 只读化 + 导出/打印               | ✅   | 已落地                                            |
| 架构文档 / API 暴露 / 测试               | ✅   | 已补齐                                            |
| Live Preview 增量化 + cell 编辑稳定性    | ❌   | 仍未完成，且缺 `editable` getter 这个 P0          |
| 协议版本校验 / origin / nonce            | 🟡   | `v` 字段已加，校验未做                            |
| 解析器统一                               | ❌   | 仍未做                                            |
| i18n 收口                                | ❌   | 表格菜单等仍硬编码中文                            |
| 死代码清理                               | 🟡   | 部分清理，仍有 `forgetLiveAsset` 等未使用         |

### 8.3 复核发现

#### P0-1：`TableCellWidget` 缺少 `editable` getter，cell 实际不可编辑

`src/editor/live-preview/plugin.ts` 中：

- `TableCellWidget.toDOM()` 在编辑态设置了 `cell.contentEditable = "true"`（约 plugin.ts:241）；
- 但 `TableCellWidget` 没有覆盖 `WidgetType.editable`，CodeMirror 默认值为 `false`。

CodeMirror 创建 widget 时（已安装版本 `@codemirror/view`，`WidgetTile.of`）：

```js
dom = widget.toDOM(view);
if (!widget.editable) dom.contentEditable = "false"; // 在 toDOM() 之后执行
```

因此首次进入编辑态的 cell 会被 CodeMirror 强制改回 `contenteditable="false"`。这解释了用户反馈的“键盘输入无效/时好时坏”：按键没有走 `TABLE_CELL_INPUT_EVENT → planCellInput` 这条 cell 输入路径，而是部分落到 CodeMirror 主编辑器的隐藏选区上；每次按键仍触发全量 Live 重建和父侧全文扫描，所以慢。

修复方向：

```ts
class TableCellWidget extends WidgetType {
  get editable() {
    return this.editing && !this.readOnly;
  }

  updateDOM(dom, _view, oldWidget) {
    // 更新 dataset/class/alignment；
    // 若 dom 当前有焦点（正在输入），不覆盖 textContent 和光标；
    // 若没有焦点（undo、title-sync、setValue 等外部变更），同步 textContent 和 caret。
    return true;
  }
}
```

同时应：

- 移除 `eq()` 里“两个 editing widget 只比较 cell 身份”的 hack。它导致 undo / 标题同步 / `setValue` 等外部变更无法更新正在编辑的 cell DOM，下一次输入会把旧 DOM 文本写回文档。
- 补一个真实 DOM 集成测试（jsdom/happy-dom 或 Zotero smoke test）。现有测试都是纯逻辑，无法覆盖 `WidgetTile.of` 这类 CM DOM 层行为。

#### P0-2：外链图片导入后不会被保存

`src/modules/markdown/tab.ts` 的 `importExternalImagesInSession`：

```ts
session.editor?.setValue(result.markdown); // 不触发 onChange
session.pendingImageSave = false;
scheduleAutosave(session);
await requestSave(session); // 非 force
```

`setValue()` 在父侧只更新 shadow value，不调用 `save.markChanged()`，因此 `SaveCoordinator.dirty === false`。非 force 请求在 `drain()` 第一轮就被跳过，后续 autosave 同样跳过：图片已写入 `assets/`，但主 md 不落盘，Zotero 同步存在风险。

修复：

```ts
session.editor?.setValue(result.markdown);
session.save.markChanged();
```

或改为 `await requestSave(session, { force: true })`；推荐前者，语义更准确。

#### P1-1：Live 装饰仍是每次按键全量重建

- `buildDecorations` 仍从第 1 行遍历到文档末尾（plugin.ts:530-547），每次 `docChanged` 都执行（plugin.ts:780-786）。
- `liveTableRows(state)` 仍全树扫描。
- 新增的 `line-cache` 只缓存单行解析结果，没有消除 O(文档行数) 的遍历和 decoration 构建。

#### P1-2：语法树滞后导致编辑态被意外关闭，且表格不会自动恢复

- `tableLayoutAt`（table.ts:112-121）直接使用可能不完整的 `syntaxTree(state)`，未使用 `ensureSyntaxTree`。
- `bootstrap.ts:284` 在 `planCellInput` 返回 null 时直接 `dispatchActiveTableCell(null)`，编辑态被关闭，后续按键自然“无效果”。
- `LivePreviewPlugin.update` 没有监听 syntax tree 完成（如 `Language.setState`）。若解析暂时不完整导致表格装饰消失，表格不会自动恢复。

复现证据：14,923 字符的文档在新建 State 时初始语法树只有前 3,009 字符；`liveTableRows()` 返回 0，`tableLayoutAt()` 返回 null。真实编辑器中 Lezer 异步补齐，因此表现“时好时坏”。

建议：

- `planCellInput` 失败时不要立即关闭编辑态；先用 `ensureSyntaxTree` 重试，或保持 active cell 下一帧再试。
- 插件在 syntax tree 完成后触发一次 decoration 重建。

#### P1-3：父侧每次 change 仍做全文扫描

`editor.ts:273-275` 每个 change 都执行 `computeStats(lastValue)`；`tab.ts` 的 `onChange` 每次按键执行 `extractFirstHeadingTitle` + `frontmatterTitleChange`。对长文档仍是每次击键多次 O(n)。

建议 stats 和标题同步独立 debounce，普通 change 只更新 shadow value + markChanged。

#### P2-1：协议只加版本字段，未真正校验

`isEditorProtocolMessage()` 仍只看 `source + type`，不检查 `v`；双方仍 `targetOrigin: "*"`，channel 仍是可猜测的 `${tabID}:${itemID}`。随机 nonce + origin/version 校验仍未做。

#### P2-2：`sendOrQueue` de-dup 有丢命令风险

`editor.ts:202-217` 现在把 `replaceRange`、`insertText` 也纳入“同类型覆盖”。iframe ready 前两次连续 `insertText`（如连续插两张图）会丢第一条。应明确区分“可覆盖”与“必须顺序执行”。

#### P2-3：图片按需只做了一半

`refreshImageAssets` 在每次变更 debounce 后仍调用 `resolveImageAssets` 解析所有引用图并整体 `setImageAssets`（tab.ts:1225-1242）。缓存减少了磁盘 IO，但大批图片时仍会构建大 JSON/data URL；`assetCache` 也没有容量上限。

#### 其他

- **close 生命周期不完整**：`closeSession` 只清理 `autosaveTimer`，未清理 `titleSyncTimer`、`imageRefreshTimer`；关闭后 title sync 仍可能触发保存。
- **Preview 切换有异步竞态**：`showReadOnlyPreview` await `requestSnapshot` 后未检查 `session.mode`，快速切回 Live 时可能把状态覆盖为“只读预览”。
- **`assets.ts` 硬编码 `v: 1`**：应复用 `EDITOR_PROTOCOL_VERSION`。
- **Prettier**：`test/live-preview-active-lines.test.ts` 与若干 docs 未格式化，跑 `pnpm run lint:fix` 可修复。

### 8.4 复核后的执行顺序

1. **立即修两个 P0**：`TableCellWidget.editable` getter（+`updateDOM`/去 eq hack），以及 `importExternalImages` 的 `markChanged`。
2. **补 DOM 层集成测试**：用 jsdom/happy-dom 或真实 Zotero smoke test 覆盖 cell 输入路径。
3. **修 cell 输入鲁棒性**：`planCellInput` 失败不关闭编辑态；syntax tree 完成后重建 decoration。
4. **再做增量 decoration + 父侧全文扫描去重**，完成 P1。
5. **最后做协议校验、解析器统一和 i18n 收口**。

### 8.5 修复记录（2026-08-15）

- ✅ `TableCellWidget` 新增 `get editable()`（`editing && !readOnly`），修复 CodeMirror `WidgetTile.of` 在 `toDOM()` 后把 cell 强制设为 `contenteditable="false"` 的问题；这是 cell 无法输入、双击无光标的根因。
- ✅ `TableCellWidget` 新增 `updateDOM()`：编辑态/渲染态互相切换时仍重建 DOM（保证输入监听器存在）；同一状态下更新时复用 DOM，并在 cell 有焦点时不打扰用户光标。移除了原来的 editing 身份 `eq` hack。
- ✅ `updateDOM()` 增加逻辑 cell 身份校验（`sameTableCellIdentity`）：CodeMirror 可能复用同类型 widget 的旧 DOM，而旧 DOM 的事件监听闭包持有旧 cell 的 `row/column` 身份，复用跨 cell 会导致点击激活/写入错误的 cell（“串 cell”）。不同逻辑 cell 现在强制重建 DOM。
- ✅ 移除 cell 上对 `input`/`composition`/`keydown` 的 capture 阶段 `stopPropagation` 隔离：capture 监听器在 target 上调用 `stopPropagation()` 会阻止**同一元素** bubble 阶段的监听器执行，导致 `emitInput` 从不触发——cell DOM 看似有文字，但 CodeMirror 文档未更新，移开光标后内容丢失。CodeMirror 已通过 `WidgetType.ignoreEvent` 忽略 cell 事件，无需额外隔离。
- ✅ 重构表格边缘操作区域：右侧新增列提示改为**只在第一行渲染一个连续按钮**，`+` 固定在 rail 垂直中心；rail 高度不再用百分比估算，而是用 `ResizeObserver` + 实际行框高度之和（减去底部 30px gutter）测量，随表格行高变化自动同步，不会超过表格内容高度。底部新增行按钮仍为最后一个独立按钮，填满最后一行保留的 30px gutter，紧贴表格。
- ✅ `importExternalImagesInSession` 在 `setValue` 后显式 `session.save.markChanged()`，修复导入外链图片后 SaveCoordinator 跳过写入的问题。
- 验证：`tsc`、`pnpm run build`、105 个单测全部通过；修改文件 Prettier/ESLint 通过。
