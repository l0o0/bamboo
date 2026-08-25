# Bamboo 竹子 代码审查报告

> 日期：2026-08-24
> 审查版本：v0.1.4（`f21593f`）
> 审查方式：全量通读 `src/`（约 3900 行 TS）、`addon/`、配置与测试；并行三个子代理分别深挖 `src/editor/`、`src/modules/markdown/`（UI 侧）、`src/editor/live-preview/`；关键论断均经实测验证（图片引用正则行为、markdown-it 15 链接校验、`delimiterCells` 边界、`pnpm test:unit` 191 例全绿）
> 环境说明：所有结论均已按 **Zotero 插件运行时环境**（`Cu.Sandbox` 特权沙箱 + `chrome://` iframe + 桌面主进程，非完整 Web 环境）重新评估，见 §10 对照表

---

## 1. 项目概览与总体评价

**Bamboo 竹子** 是一个 Zotero 插件：把 `.md` 附件变成 Zotero 内的一等公民（打开、编辑、实时预览、图片管理、公开 API）。架构要点：

- 编辑器跑在 `chrome://` iframe 里（`src/editor/bootstrap.ts`），通过带 channel 的 postMessage 协议与主窗口通信（`src/modules/markdown/editor-protocol.ts`），把 CodeMirror 6 的 DOM 需求与 Zotero 沙箱隔离
- 所有写入收敛到单一路径 `persistMarkdownContent`（`src/modules/markdown/persist.ts`），配单写者保存队列 `SaveCoordinator`（防丢改动的设计有测试覆盖）
- 会话按窗口隔离（`session-registry.ts`），异步渲染普遍带 `renderSeq` 失效守卫
- Live Preview 采用"每次从当前 state 全量重建装饰、从不保留旧 DecorationSet 做位置映射"的策略——**在架构层面彻底规避了 decoration 位置漂移**，代价是性能
- 191 个单元测试全部通过

**总体结论**：工程质量明显高于一般 Zotero 插件，无 XSS 注入点、无高危崩溃级缺陷；核心数据路径正确、细节用心（表格交互、IME 组合输入、DOM 复用身份校验）。主要问题集中在**两条数据一致性裂缝**（图片清理误删、API 与打开中编辑器的并发写）和**一个 Zotero 环境特有的权限边界问题**（公开 API = 任意文件读写原语）。

---

## 2. 高优先级（数据安全，建议尽快修）

### 2.1 图片清理会把"识别不了的引用"当未引用并静默删除文件（数据丢失）

- 位置：`src/modules/markdown/images/model.ts:75-88`、`src/modules/markdown/images/service.ts:105-133`
- 触发：显式保存（Ctrl+S，`tab.ts:879`）和关闭标签（`tab.ts:1793`）都会以 `cleanupImages: true` 执行 `cleanupUnusedImageAssets`

清理逻辑用正则 `!\[([^\]\n]*)\]\(([^\s)]+)\)` 反推"被引用的图片"，实测（node 验证）以下常见写法**不被识别为引用**，保存时对应图片文件被删除：

| Markdown 引用写法                                  | 正则是否匹配 | 后果                             |
| -------------------------------------------------- | ------------ | -------------------------------- |
| `![a](assets/img.png)`                             | ✅           | 正常                             |
| `![a](assets/my image.png)`（文件名带空格）        | ❌           | **Ctrl+S 时图片被删除**          |
| `![a](<assets/img.png>)`（尖括号形式）             | ❌           | **被删除**                       |
| `![](./assets/img.png)`（相对路径，Obsidian 常见） | ❌           | **被删除**                       |
| `![[Pasted image.png]]`（Obsidian wikilink）       | ❌           | **被删除**                       |
| `![a](assets/img(4).png)`（URL 内括号）            | ⚠️ 部分匹配  | 不渲染（文件不被删，但显示缺失） |

目标用户是 Obsidian 用户，而 Obsidian 最常见的就是空格文件名和 wikilink——**每次显式保存都可能静默删图**。

建议：清理前对"未引用"资产做二次确认（扫描更宽松的模式），或仅清理插件自己生成的 `\d+-[a-z0-9]+\.(png|jpg|gif|webp)` 命名模式资产。

### 2.2 API `update(force: true)` 与打开中编辑器存在 TOCTOU 竞态，可静默丢掉用户正在输入的内容

- 位置：`src/modules/markdown/api.ts:262-295`

```ts
async function currentContent(item) {
  ...
  return (await session.editor.requestSnapshot()) ?? ...;  // await 期间用户可能继续输入
}
// writeContent:
if (session?.editor) {
  session.editor.setValue(content);          // 用"旧"快照整体覆盖缓冲区
  await session.save.request({ force: true });
}
```

`update()` 先 `await` 快照 v1（postMessage 往返最长 400ms），期间用户打字产生 v2；随后 `setValue(v1)` 把缓冲区整体替换回 v1 并强制落盘——v2 永久丢失，且因 `setValue` 抑制 change 事件（`fromParentAnnotation`），状态栏毫无察觉。

建议：写前比对快照与 `getValue()`，不一致则抛 `WRITE_CONFLICT`；或改用 `replaceRange`/增量 diff 合并。

### 2.3 `trash()` / `rename()` 不感知打开中的会话

- 位置：`src/modules/markdown/api.ts:441-473`

- `trash()` 后打开的 tab 仍存活，下一次 autosave 会把文件**重新写回已删除附件的路径**（"复活"被删数据，还会重新标记 `to_upload` 同步到其他设备）
- `rename()` 只改磁盘/条目，`session.path` 过期，文档信息弹窗（`tab.ts:1267`）展示旧路径

建议：trash 前 flush/关闭相关 session；对已 trash 条目的写入一律拒绝。

---

## 3. 安全

### 3.1 【Zotero 特有·升级】公开 API 是无权限边界的任意文件读/写/重命名原语

- 位置：`src/modules/markdown/api.ts:374-408`（`createLinked`）、`342-349`（`read`）、`441-467`（`rename`）

组合链：

```ts
await md.createLinked({ path: "/Users/me/.ssh/config" }); // 任意已存在路径
// createLinked 内部强制 contentType = "text/markdown"（api.ts:403-406）
await md.read(created.itemID); // → isMarkdownAttachment 通过 → 返回文件全文
```

- 任何能调用 `Zotero.ZoteroMarkdown.api.markdown` 的插件/MCP 桥，可读取 Zotero 进程可读范围内的**任意文件全文**；`update()` 可写回任意内容；`rename()` 可改磁盘文件名（API 路径**没有** UI 重命名路径的 `normalizeMarkdownFilename` 清洗，`"../evil"` 会原样传给 `renameAttachmentFile`）
- README 明确将该 API 推荐给 **MCP 桥**使用——MCP 桥正是提示注入的重灾区：被注入的 LLM 可通过这条干净、文档化的 API 读写用户文件，无需任何确认

建议：`createLinked` 限定扩展名/大小；`rename` 复用 `normalizeMarkdownFilename`；`update` 拒绝非文本附件；并在文档中明确此 API 的信任边界。

### 3.2 【Zotero 特有·升级】"导入外链图片"的 fetch 以 chrome 权限运行：无 CORS、无超时、无下载大小上限

- 位置：`src/modules/markdown/images/service.ts:135-165`

```ts
const response = await fetch(image.source); // Zotero 7+ 沙箱内置 fetch，chrome 权限，不受 CORS 限制
const bytes = new Uint8Array(await response.arrayBuffer()); // 先整包进内存，之后才校验 ≤15MB
```

- 恶意/失误的 `.md` 附件 + 用户点一次"导入外链图片"→ 特权进程可**探测本机/内网任意 http 服务**（`127.0.0.1`、云元数据 `169.254.169.254` 等），响应若是图片类型还会被完整写入本地存储
- 浏览器里这是普通网页请求；Zotero 里这是**特权进程发起的无 CORS 请求**，且附件常来自不可信来源

建议：下载前校验 URL（仅 http/https + 拒绝私有网段）+ `AbortController` 超时 + `Content-Length` 预检（若沙箱无 AbortController，用 `Zotero.HTTP.request`，自带超时/重试语义）。

### 3.3 远程图片在特权文档中自动加载（隐私面）

- 位置：`src/editor/live-preview/plugin.ts:138-150`（iframe 内 `ImageWidget`）、`src/modules/markdown/preview.ts:281-333`（chrome 文档预览模式）

markdown 里的外链图片**打开即加载**：无用户确认、无 referrer 约束，Zotero 也没有浏览器式的权限指示 UI。跟踪像素/IP 泄露/内网探测比浏览器环境更隐蔽。`javascript:`/`file:` 已被 `^https?://` 白名单挡住（这是好的）。

建议：至少 `img.referrerPolicy = "no-referrer"`；长远加"不加载远程图片"设置项。

### 3.4 iframe 侧 postMessage 监听器不校验 `event.source`（纵深防御缺口，已降级）

- 位置：`src/editor/bootstrap.ts:1236-1251`

只校验 `source` 字符串标记、type 白名单和 channel（`${tabID}:${itemID}`），**没有校验 `event.source === window.parent`**。伪造 `setValue`/`replaceRange`/`destroy` 可控制编辑器内容与状态。

**Zotero 环境下的真实威胁等级（低）**：插件主代码跑在 sandbox 里，默认没有主窗口 DOM 访问权，拿不到 `iframe.contentWindow` 引用；只有运行在窗口 document 上下文里的代码（Zotero 核心、主动注入窗口的插件）才能伪造——而它们本就拥有全部 chrome 权限。故属纵深防御而非可利用漏洞，但修复成本极低：

```ts
// bootstrap.ts onWindowMessage 开头
if (event.source !== window.parent) return;
```

注意：iframe 是 `chrome://zoteromarkdown`、父窗口是 `chrome://zotero`，跨 origin 下 `event.origin` 不可靠，只能比对 source。同时 `v: EDITOR_PROTOCOL_VERSION` 从未校验，`replaceRange` 的 from/to 无边界钳制（越界坐标让 CM 抛 RangeError，被 try/catch 吞掉）。

### 3.5 渲染 HTML 进入 chrome 特权文档（"薄冰式"安全，需收口）

- 位置：`src/modules/markdown/preview.ts:281-333`、`src/modules/markdown/export-document.ts:41-60`

实测 markdown-it 15（`html: false`）：

| 输入                                                             | 结果                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `[c](javascript:alert(1))`、`[c](data:...)`、`[c](vbscript:...)` | ✅ 被默认 `validateLink` 拦截（渲染为纯文本）                                            |
| `[c](%6aavascript:alert(1))`                                     | ⚠️ 生成 `<a href="%6aavascript:...">`（浏览器不解码 scheme，不执行，但 href 未白名单化） |
| `![img](data:image/png;base64,AAAA)`                             | ⚠️ `data:` 图片不被拦截（img 上下文中 inert）                                            |
| 原始 `<script>` / `<img onerror>`                                | ✅ 被转义                                                                                |

当前**没有 XSS 注入点**（全仓库 grep 无 innerHTML/document.write 注入 markdown 内容，渲染全部走 textContent；highlight.js 输出正确转义）。但在 Zotero 中，chrome 文档内的 XSS = 完全 RCE，值得收口：

- 配置显式 `validateLink` 白名单（仅 `http:`/`https:`/`mailto:`）
- `openPrintableDocument` 的打印窗口：`document.write` 无 try/catch、打印后不关窗、外链 `<img>`/自动链接会在 chrome 窗口发起远程请求 → 加 `rel="noopener noreferrer"`、try/catch、`printWin.close()`

### 3.6 【Zotero 特有】渲染在主线程执行，大文档会冻结整个 Zotero

- 位置：`src/modules/markdown/preview.ts:48-61`（markdown-it 渲染）、`src/modules/markdown/code-highlight.ts`（hljs 高亮）

插件沙箱跑在 Zotero 桌面主进程，无 Web Worker 可逃。超大 `.md`（如贴入的 10MB 代码/数据）在预览/导出时会让**整个应用 UI 卡死**。建议给渲染加长度阈值/分块，或至少文档化。

### 3.7 `.env` 中的 GitHub Token（已清理）

审查时发现 `.env` 含一个真实 GitHub PAT。已确认 `.gitignore` 覆盖 `.env`、未入库，并已在本轮将 token 值清除（留空占位，由用户手动配置）。**该 token 曾出现在本工作区快照中，建议在 GitHub 上轮换**。

---

## 4. 中等（一致性 / 竞态）

| #    | 位置                                                   | 问题                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `sidebar.ts:656-692`                                   | **侧栏编辑器不注册进 sessionRegistry**：API `update()` 对"正在侧栏编辑的附件"看不到 dirty，`WRITE_CONFLICT` 永不触发，API 写入与侧栏 1.5s autosave 会互相静默覆盖                                                                                                 |
| 4.2  | `tab.ts:1647-1664` + `bootstrap.ts:1042-1046`          | 标题同步用父侧镜像 `lastValue` 计算 `replaceRange` 坐标，打字竞态下坐标过期（CM 抛错被吞/错位改写 frontmatter）                                                                                                                                                   |
| 4.3  | `tab.ts:1583-1586`                                     | `refreshImageAssets` catch 后 `throw`，而调用方全是 `void refreshImageAssets()` → unhandled rejection（Zotero 沙箱中仅进错误控制台不崩溃，但 `[Bamboo][ImageDebug]` 的 `Zotero.debug` 是调试残留无条件执行；`sidebar.ts:748-759` 的同类函数正确吞错，行为不一致） |
| 4.4  | `api.ts:284-287`                                       | 打开会话时 `update({cleanupImages:true})` 的 cleanupImages 被丢弃，契约与实现不符                                                                                                                                                                                 |
| 4.5  | `api.ts:434-436`                                       | `patchFrontmatter` 无变更分支硬编码 `openInTab: false`，与 `update()` 语义不一致                                                                                                                                                                                  |
| 4.6  | `api.ts:230,235`、`sidebar.ts:566-568`、`create.ts:45` | `getDisplayTitle()` 在部分 Zotero 构建返回 Promise（`tabHooks.ts:77-84` 自己都做了兼容），这里直接 `String()` 拼接会得到 `"[object Promise]"`                                                                                                                     |
| 4.7  | `sidebar.ts:453-474` + `hooks.ts:87-96`                | 窗口关闭时侧栏 flush 是 fire-and-forget（`void this.flush()`），对比 tab 会话有 `await flushSessionsForWindow`——关窗会丢未保存修改                                                                                                                                |
| 4.8  | `sidebar.ts:761-777`                                   | `insertImage` 无 `renderSeq` 守卫：await 写文件期间切换条目，图片标记会插进新文档、文件却写进旧条目                                                                                                                                                               |
| 4.9  | `tab.ts:1601-1623`                                     | autosave 抢跑标题同步时退化为整文 `setValue`，**清空 CodeMirror 撤销历史**（`applyTitleSync` 正确用 replaceRange，这里不一致）                                                                                                                                    |
| 4.10 | `bootstrap.ts:949-1022` vs `1192-1208`                 | 销毁清理逻辑重复两份（clearTimeout→removeListeners→cancelTableDrag→destroy），易漏改；`theme.ts` 690 行 dark/light 两套主题体量重复                                                                                                                               |

---

## 5. 性能与资源

| #   | 位置                               | 问题                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | `live-preview/plugin.ts:898-934`   | **Live Preview 每次 update 全文档重建装饰**，且触发面包含 `viewportChanged`（滚动）/`geometryChanged`（缩放），内部还做 3 遍 `state.doc.line(n)` 全文档扫描（`plugin.ts:657-667`）+ 每行 `parseMarkdownImages` 正则。大文档滚动/打字明显卡顿（Zotero 主进程中影响整个应用）。建议：重建条件去掉 viewport/geometry（CM 会按视口裁剪），合并为单遍 `iterLines()`，光标移动只重建新旧活跃行 |
| 5.2 | `bootstrap.ts:1166-1191`           | `runtime.imageAssets` 永远 merge 不清除旧 key，每个 dataUrl 最大 ~20MB（15MB × 4/3 base64），会话内贴过又删的图片全部驻留，**内存泄漏**。`setImageAssets` 应改为整表替换（父进程已发完整集合）                                                                                                                                                                                           |
| 5.3 | `live-preview/assets.ts:4-30`      | 资产解析失败后 reference 永久留在 `requested` 集合，"图片缺失"占位**永不更新**（用户修复附件也不重试，直到重启会话）；`requested` 无清理路径；`forgetLiveAsset` 是死代码                                                                                                                                                                                                                 |
| 5.4 | `live-preview/line-cache.ts:24-56` | 缓存按**插入序** FIFO 淘汰 + 全量重建按行号顺序插入 = 文档 >2500 行时**持续抖动**（每次重建重解析一个滚动窗口，命中率趋近 0）；且按条数而非字节设限。建议 LRU（命中刷新访问序）                                                                                                                                                                                                          |
| 5.5 | `editor.ts:224-247`                | iframe 永不 ready 时 `pending` 队列无限增长（`requestSnapshot` 入队后不清理）；8s 超时注释写"resolve so callers don't hang"但实际 `ready` 永不 resolve，注释与行为不符                                                                                                                                                                                                                   |
| 5.6 | `images/service.ts:50`             | `assetCache` 无界缓存 base64 dataURL（按路径+时间+大小作 key，跨会话不清理）                                                                                                                                                                                                                                                                                                             |
| 5.7 | `api.ts:303-335`                   | `list()` 逐附件顺序 await `getFilePathAsync` 磁盘 IO + 循环内 `sessionRegistry.all().find` O(n²)；未过滤已 trash 的 item；`flush()` 用 `Promise.all` 建议 `allSettled`                                                                                                                                                                                                                   |
| 5.8 | `live-preview/plugin.ts:688`       | 同一行图片被解析 3 遍（active+inactive 两套 imagePlans + `lineImageRanges`），原始 image ranges 应一并缓存                                                                                                                                                                                                                                                                               |

---

## 6. 解析边界 bug（live-preview 专项）

| #   | 位置                                                       | 问题                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | `live-preview/structure.ts:22-39`                          | **代码栅栏提前闭合**：闭合判断允许栅栏后任意尾随内容（CommonMark 规定闭合栅栏后只能跟空白），代码块内容行 ` ```js ` 被误判为闭合 → 后续行失去代码块样式（纯显示问题）                                 |
| 6.2 | `live-preview/active-lines.ts:26-41` vs `outline.ts:19-25` | **frontmatter 判定双实现不一致**（`trim()` 比较 vs `startsWith("---\n")`）；文档以 `---`（水平线）开头且无闭合时，**整篇文档失去全部 live 样式**。建议抽公共函数，处理 `...` 闭合、`\r\n`、未闭合降级 |
| 6.3 | `live-preview/inline.ts:52-73`                             | 转义标记未处理（`\*\*bold\*\*` 仍渲染为加粗——em 分支检查了转义、strong/strike 分支没查）；双反引号代码块、嵌套链接解析错位                                                                            |
| 6.4 | `live-preview/inline.ts:21-91`                             | 全 `*`/`~` 长行 O(n²)（每个位置全行 `indexOf` 扫描）                                                                                                                                                  |
| 6.5 | `live-preview/plugin.ts:417-431`                           | 表格 cell 的 rAF focus 竞态：widget 在 rAF 前被重建时对已脱离文档的节点 `removeAllRanges()` 清掉真实选择；加 `if (!cell.isConnected) return` 守卫                                                     |
| 6.6 | `live-preview/plugin.ts:952-958`                           | `composing` 标志无复位兜底：compositionend 丢失（失焦/销毁）后该行永远按活跃行渲染；可在 `update()` 检测 `!view.hasFocus` 时复位                                                                      |
| 6.7 | `table.ts:89-100`                                          | `delimiterCells` 手写解析弱健壮性——初报的具体断言（"`---                                                                                                                                              | ---`只解析出 1 个 cell"）经逐例推演**不成立**（多数边缘情况被`slice(0, columnCount)` 自愈），仅作低优先级提示 |
| 6.8 | `structure.ts:48-54`                                       | `#` 单独一行（合法空标题）不识别；`LIST_RE` 对 10+ 位数字按有序列表处理（CommonMark 限 9 位）                                                                                                         |
| 6.9 | `table.ts:68-87` / `plugin.ts:708-745`                     | `a\|\|b` 空单元格丢列（`pipe.from > cursor` 严格大于），gridColumn 错位（纯视觉）                                                                                                                     |

**正面确认**：装饰每次从当前 state 全量重建、从不 map → **不存在编辑时 decoration 位置漂移**；行缓存以精确文本为 key → 无陈旧失效；表格 widget DOM 复用有 `sameTableCellIdentity` 身份校验 + `updateDOM` 返回 false 强制重建，避免"内容落入错误单元格"。

---

## 7. 轻微与可维护性

- **国际化名存实亡**：有完整的 en-US/zh-CN FTL 体系和 `getString()`，但全 UI 约 80 处硬编码中文字符串（`modal.ts`、`more-menu.ts`、`tab.ts`、`status.ts` 等），英文用户看到中文界面；且 `setStatus`（`tab.ts:1716-1738`）用 `t.includes("未保存")` 对本地化文本做字符串匹配决定状态样式，一旦接入翻译即失效
- **死代码**（grep 全仓库确认无调用）：`utils/window.ts` `isWindowAlive`、`live-preview/assets.ts` `forgetLiveAsset`、`active-lines.ts` `shouldSkipLiveLine`/`frontmatterLineNumbers`、`inline.ts` `parseInlineL1`、`structure.ts` `fencedCodeLineKinds`、`image-debug.ts`（`?debug=1` 无人设置，永远关闭）；`table.ts:194-199` `cellWidgetRange` 的 `point: true` 分支不可达
- **快捷键**（`menu.ts:167-195`）：pref 值未校验（外部写入裸 `"M"` 则按 M 就建笔记）、不检查 `ev.defaultPrevented`（设置弹窗打开时快捷键仍触发）
- 小项：`createLinked` 用 `as unknown as` 强塞 libraryID；`more-menu.ts:35` 硬编码 "⌘F"（Windows 用户看到 ⌘）；`shortcut.ts` 空格键录入产生 `"accel, "` 无效快捷键；`create-target.ts:10-16` 不过滤 `collectionID === 0`；`applyDocChanges` 无边界校验；`persist.ts:13` TODO 双写路径未统一；`modal.ts` 设置单例跨窗口（`activeSettingsDestroy`）；`bindMarkdownSettingsPreferencePane` 返回的 cleanup 被丢弃；`injectMarkdownStyles` 每次 remove 再重建 1400 行 `<style>`（有短暂闪动）；`tabHooks.ts` 直接改写 `Zotero_Tabs.tabHooks` 无注销路径且 `focusFirst = refocus` 共用引用
- **多窗口 UX**：`openMarkdownAttachment` 签名不接受 win，FileHandlers 补丁（`open.ts:31-47`）与菜单路径都默认 `Zotero.getMainWindow()`——用户在第二个窗口双击附件，标签页开在主窗口（`api.openTab` 是唯一正确传 win 的路径）
- **`ensureDOMGlobals` 多窗口全局竞态**（`utils/dom.ts:15-86`）：sandbox 全局 `window/document` 绑定到最后一个加载的窗口，多窗口并发启动时全局可能指向错误窗口——多数代码显式传 win 所以未变成 bug，但属易踩坑设计

---

## 8. 测试情况

- 191 个单测全绿；`SaveCoordinator`/`SessionRegistry`/表格操作/协议校验等关键纯逻辑有覆盖
- **缺口**：`images/service.ts`（清理/导入的 I/O 与误删边界——正是最高危发现所在）、`api.ts` 并发语义、侧栏/编辑器集成无测试；CI 里测试 job 被注释（`ci.yml`），只有 lint + build

---

## 9. 亮点

1. **无 XSS 注入点**：markdown 内容进入 DOM 全部走 `textContent`/`createElement`；markdown-it `html:false` + 默认 validateLink 实测拦截 `javascript:`/`data:` 链接；highlight.js 输出正确转义
2. **写入路径收敛**：编辑器、API、侧栏共用 `persistMarkdownContent` + 单写者 `SaveCoordinator`（"写期间继续输入不丢"有测试覆盖）
3. **Live Preview 用"每次全量重建"换位置一致性**，彻底规避 decoration 漂移类 bug
4. 会话按窗口隔离（多窗口各有独立 tab）、注册-注销对称、`renderSeq` 竞态守卫、表格 cell 的 compose/IME 处理细节用心
5. Zotero 9/10 兼容层（`compat/zotero-pane.ts`）、FTL 基础设施、CI lint+build 齐全、191 个单测

---

## 10. 修复优先级建议（Zotero 环境视角）

1. **图片误删**（§2.1，纯逻辑，最高优先）
2. **API 任意文件读写边界**（§3.1，MCP/提示注入场景，收紧 createLinked/rename/update）
3. **API force 写入竞态**（§2.2）+ **trash 不感知会话**（§2.3）
4. **SSRF 收紧**（§3.2，特权 fetch + 无超时无上限）
5. 远程图片 referrer/开关（§3.3）+ `validateLink` 白名单 + 打印窗口加固（§3.5）
6. iframe 侧 `event.source` 校验（§3.4，一行）+ 多窗口标签页传 win（§7）
7. Live Preview 性能与资源（§5.1-5.4）+ 解析边界 bug 组（§6）
8. i18n 收口、死代码、`Zotero.debug` 调试残留清理

---

## 附录：Zotero 运行时环境重新评估对照表

| 发现                                        | 浏览器环境评级 | Zotero 环境评级  | 说明                                               |
| ------------------------------------------- | -------------- | ---------------- | -------------------------------------------------- |
| 图片清理误删（§2.1）                        | 高             | **高（不变）**   | 纯逻辑，与运行环境无关                             |
| API force 写入竞态（§2.2）                  | 高             | **高（不变）**   | JS 异步语义在沙箱相同                              |
| API 任意文件读写（§3.1）                    | 中             | **升级·高**      | README 面向 MCP 桥，提示注入面                     |
| 导入外链图片 SSRF（§3.2）                   | 中             | **升级·中高**    | 沙箱 fetch 为 chrome 权限，无 CORS                 |
| 远程图片自动加载（§3.3）                    | 低             | **升级·中低**    | 附件不可信 + 无权限指示 UI                         |
| iframe postMessage 无 source 校验（§3.4）   | 中             | **降级·低**      | 沙箱插件无窗口 DOM 访问权，纵深防御                |
| iframe 加 `sandbox` 属性（原建议）          | 中             | **撤回**         | Firefox 对 system principal 文档忽略 sandbox，无效 |
| 渲染进 chrome 特权文档（§3.5）              | 低             | **中低（收口）** | chrome 文档内 XSS = RCE，当前防护实测有效          |
| 主线程渲染（§3.6）                          | 低             | **升级·中低**    | 桌面主进程无 Worker，大文档冻结整个应用            |
| unhandled rejection（§4.3）                 | 中             | **降级·低**      | 沙箱中仅进错误控制台，不崩溃                       |
| Live Preview 性能/资源（§5）                | 中             | **中（不变）**   | iframe 是真实浏览器文档，行为一致                  |
| 多窗口开错窗口、ensureDOMGlobals 竞态（§7） | —              | **新增·低**      | Zotero 特有（多主窗口 + 共享沙箱）                 |
| `.env` GitHub token                         | —              | **已清理**       | 建议轮换                                           |

---

## 附录 B：修复状态（2026-08-24）

| 报告条目                                 | 状态        | 变更内容                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.1 图片清理误删                        | ✅ 已修复   | `images/model.ts`：`parseMarkdownImages` 支持尖括号目的地（含空格文件名/标题）；`normalizeAssetReference` 容忍 `./` 前缀；`referencedAssets` 统计 wikilink `![[...]]`；**新增 `GENERATED_ASSET_RE`/`isGeneratedAsset`——清理只删除插件自生成命名的资产，用户文件永不误删**。新增 4 组测试                                                                               |
| §3.4 iframe postMessage 无 source 校验   | ✅ 已修复   | `editor/bootstrap.ts`：`onWindowMessage` 增加 `event.source !== window.parent` 拒绝                                                                                                                                                                                                                                                                                    |
| §2.2 API force 写入 TOCTOU 竞态          | ✅ 已修复   | `modules/markdown/api.ts` `writeContent`：写入前比对 `getValue()` 与待写内容，非 force 且不一致时抛 `WRITE_CONFLICT`                                                                                                                                                                                                                                                   |
| §2.3 trash/rename 不感知会话             | ✅ 已修复   | `api.ts`：`trash()` 先关闭该条目的所有打开会话（flush 后关 tab）；`rename()` 成功后同步所有会话的 `session.path`                                                                                                                                                                                                                                                       |
| §3.2 SSRF 收紧                           | ✅ 已修复   | `images/service.ts`：新增 `isSafeExternalImageUrl`（仅 http/https，拒绝 localhost/私网/环回/保留地址）；下载加 15s `AbortController` 超时 + `content-length` 预检。新增测试文件 `test/image-import-safety.test.ts`                                                                                                                                                     |
| §3.5 validateLink 白名单 + 链接/图片加固 | ✅ 已修复   | `preview.ts`：覆写 `md.validateLink` 方法（markdown-it 15 是实例方法而非构造选项）拒绝非 http(s)/mailto 绝对 URL（含 `%6aavascript:` 编码绕过，实测验证）；`link_open` 加 `rel="noopener noreferrer"`、`image` 加 `referrerpolicy="no-referrer"`；`live-preview/plugin.ts` 的远程图片同样加 `no-referrer`；`export-document.ts` 打印窗口 `document.write` 加 try/catch |
| §7 存量 prettier 失败                    | ✅ 顺手修复 | `table-cell-edit.ts`、`live-preview-active-lines.test.ts` 及 6 个 docs 文件格式化，`lint:check` 恢复全绿                                                                                                                                                                                                                                                               |

验证：`pnpm run lint:check` ✓、`pnpm run test:unit` 195 例全绿（原 191）✓、`pnpm run build`（含 `tsc --noEmit`）✓。

### 第二轮（同日）

| 报告条目                        | 状态      | 变更内容                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1 API 权限边界               | ✅ 已修复 | `detect.ts` 新增 `isMarkdownFilename`；`createLinked` 仅接受 Markdown 扩展名（杜绝 `createLinked`+`read` 变成任意文件读取原语）；`rename` 复用 `normalizeMarkdownFilename`（UI 同款清洗，封堵 `../` 路径穿越重命名）                                                                                                                                 |
| §4.1 侧栏会话登记               | ✅ 已修复 | `sidebar-state.ts` registry 新增 `all()`（显式 Set 跟踪，避免 WeakMap 迭代 lib 限制）；`sidebar.ts` 新增 `currentItemID`/`getSession()`/`findSidebarSessions`；`api.ts` 的 `currentContent`/`writeContent` 感知侧栏会话：读优先取侧栏缓冲区，写时任一编辑器 dirty 或缓冲区漂移即抛 `WRITE_CONFLICT`，写入应用到所有打开的编辑器（多窗口 tab + 侧栏） |
| §4.3 refreshImageAssets 重抛    | ✅ 已修复 | `tab.ts` 不再 `throw`，与 sidebar 行为一致，消除 `void` 调用的 unhandled rejection                                                                                                                                                                                                                                                                   |
| §4.5 patchFrontmatter openInTab | ✅ 已修复 | 无变更分支的 `openInTab` 改为真实查询会话，与 `update()` 语义一致                                                                                                                                                                                                                                                                                    |
| §4.6 getDisplayTitle 异步       | ✅ 已修复 | `api.ts` 新增 `displayTitle()`（await Promise 型返回值）用于 `attachmentInfo`；`sessions()` 同步路径跳过 Promise 型；`sidebar.ts` renderList 与 `create.ts` titleBase 同样防护                                                                                                                                                                       |
| §5.1 全文档重建触发面           | ✅ 已修复 | `live-preview/plugin.ts`：重建条件去掉 `viewportChanged`/`geometryChanged`（滚动/缩放不再触发 O(doc) 重建，CM 自行按视口渲染）；行收集改为单遍扫描（原 3 遍）                                                                                                                                                                                        |
| §5.2 imageAssets 无界累积       | ✅ 已修复 | 协议 `setImageAssets` 增加 `replace` 标志：全量推送（refresh 路径）整表替换，单资产推送（插入图片后）merge——已删除引用的 dataURL 不再驻留                                                                                                                                                                                                            |
| §5.3 资产失败永不重试           | ✅ 已修复 | 激活原死代码 `forgetLiveAsset`：`assetResolved` 失败时清除记忆，`requestLiveAsset` 加 10s 冷却重试；`ImageWidget` 未解析时每次渲染都请求                                                                                                                                                                                                             |
| §5.4 行缓存 FIFO 抖动           | ✅ 已修复 | `line-cache.ts` 命中时刷新访问序（LRU），大文档下工作集保持热；图片引用解析并入缓存（消除每行 3 遍解析）                                                                                                                                                                                                                                             |
| §6.1 栅栏提前闭合               | ✅ 已修复 | `structure.ts` 拆分 `FENCE_OPEN_RE`/`FENCE_CLOSE_RE`，闭合仅允许 fence + 空白（CommonMark）；新增测试                                                                                                                                                                                                                                                |
| §6.2 frontmatter 未闭合吞全文   | ✅ 已修复 | `active-lines.ts`：未闭合（或 `---` 水平线）返回空集，不再禁用整篇 live 样式；闭合兼容 `...`                                                                                                                                                                                                                                                         |
| §6.3 inline 转义/多反引号       | ✅ 已修复 | `inline.ts`：strong/strike 开口与闭合均检查转义；em 闭合跳过 `**` 连写与 `\**` 转义对；代码支持多反引号 run；新增测试                                                                                                                                                                                                                                |
| §6.5 / §6.6                     | ✅ 已修复 | cell rAF focus 加 `isConnected` 守卫；`composing` 失焦时复位                                                                                                                                                                                                                                                                                         |
| §7 死代码清理                   | ✅ 已修复 | 删除 `utils/window.ts`（isWindowAlive）、`shouldSkipLiveLine`、`frontmatterLineNumbers`（字符串版）、`parseInlineL1`、`fencedCodeLineKinds`（字符串版）及对应导出与测试                                                                                                                                                                              |

验证：`pnpm run lint:check` ✓、`pnpm run test:unit` **197 例全绿**（191 → 197）✓、`pnpm run build`（含 `tsc --noEmit`）✓、全量测试连续 5 轮 + 压力 20 轮无失败（一次偶发为 CM 惰性解析的存量 flake，与本次改动无关）。

### 第三轮（同日）

| 报告条目                                  | 状态      | 变更内容                                                                                                                                                                                                             |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.2 标题同步 replaceRange 过期坐标       | ✅ 已修复 | `bootstrap.ts` 的 `replaceRange` 对 from/to 做有限性校验与文档范围钳制，越界坐标不再让 CM 抛 RangeError（竞态退化为安全忽略）                                                                                        |
| §4.7 侧栏关窗 flush 不等待                | ✅ 已修复 | `SidebarController.destroy()` 返回 Promise 并先捕获 save/editor 引用再置空，flush 落盘后才销毁编辑器；`disposeSidebarForWindow`/`unregisterSidebarSection` 改为 async 且 `hooks.ts` 的窗口卸载/关停路径 `await` 等待 |
| §4.8 sidebar insertImage 无守卫           | ✅ 已修复 | `insertImage` 捕获 `renderSeq`，两次 await 后校验条目未切换/未销毁，杜绝图片标记插入新文档                                                                                                                           |
| §4.9 scheduleAutosave 清空 undo           | ✅ 已修复 | 标题同步改走 `replaceRange`（与 `applyTitleSync` 一致），不再整文 `setValue`                                                                                                                                         |
| §5.5 editor pending 无限增长 / ready 挂起 | ✅ 已修复 | pending 队列加 256 条上限（溢出丢最旧）；8s 超时后真正 `resolveReady()`（注释与行为一致），调用方不再永久挂起                                                                                                        |
| §5.6 assetCache 无界                      | ✅ 已修复 | `images/service.ts` 缓存改 LRU + 200 条上限                                                                                                                                                                          |
| §5.7 api list/flush                       | ✅ 已修复 | `list()` 一次构建会话 Map（消除 O(n²) 扫描）并过滤已 trash 条目；`flush()` 改 `allSettled` 并返回成功数                                                                                                              |
| §6.4 inline 长行 O(n²)                    | ✅ 已修复 | `inline.ts` 对 4+ 同字符分隔符 run 整体跳过（O(n)），粘贴万级 `*`/`~` 行不再卡顿                                                                                                                                     |
| §6.8 `#` 空标题 / LIST 9 位限制           | ✅ 已修复 | `ATX_RE` 支持裸 `#`（CommonMark 合法空标题）；有序列表标记限 9 位数字                                                                                                                                                |
| §6.9 空单元格丢列                         | ✅ 已修复 | `rowCells` 在相邻管道（`a\|\|b`）处保留空单元格，列数不再错位（`cellWidgetRange` 的 point 分支随之启用）                                                                                                             |
| §7 setStatus 状态机制                     | ✅ 已修复 | `setStatus` 改为显式 `SaveStatusKind`（saved/dirty/error/info），CSS 状态类不再依赖对（可能本地化的）文本做 `includes` 匹配；10 处调用点全部更新                                                                     |

验证：`pnpm run lint:check` ✓、`pnpm run test:unit` **201 例全绿**（197 → 201）✓、`pnpm run build` ✓。新增测试：表格空单元格（2）、裸 `#`/9 位列表/长 run（3）。

### 第四轮（同日）

| 报告条目                      | 状态        | 变更内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7 i18n 收口（主批次）        | ✅ 已修复   | **约 60 处 UI 硬编码字符串迁移到 FTL**：新增 ~100 个键（en-US/zh-CN `mainWindow.ftl` 各 +100 行，`typings/i10n.d.ts` +103 行）。覆盖：工具栏（save/undo/redo/格式按钮的 title+aria）、状态栏（含 `{ $count }`/`{ $time }` 插值）、kebab 菜单（`more-*`，标签改渲染期解析）、设置页（`settings-*`）、文档弹窗（`modal-*`）、侧栏工具栏（`sidebar-*`）、只读预览页（`preview-*`）、导出标题。`more-menu.ts`/`settings-pages.ts` 的模块级 label 改为 key 映射 + 渲染期 `getString`（避免启动前求值）；`utils/locale.ts` 的 `_getString` 加固为无 `addon` 环境安全回退（测试/启动前不再抛错） |
| §7 setStatus 文本匹配（收尾） | ✅ 已修复   | 上轮枚举化后，本轮所有状态文案改走 `getString`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 存量测试 flake（CM 惰性解析） | ✅ 顺手修复 | `outline.ts`/`table.ts` 的树遍历改用 `ensureSyntaxTree`（编辑器内通常已解析、零开销；测试与初始化竞态下确定化）——消除 outline/table 测试在负载下的偶发失败                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 剩余硬编码                    | 📋 记录     | 仅剩 ~19 处**错误诊断**文案（`tab.ts`/`images/service.ts` 的 throw/ProgressWindow 错误信息）与品牌名"Bamboo 竹子"，作为后续可选项                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

验证：`pnpm run lint:check` ✓、`pnpm run test:unit` **202 例全绿**（201 → 202）✓、`pnpm run build` ✓、全量测试连续 3 轮稳定。

**四轮累计**：修复 40+ 项（数据安全 4、安全加固 6、一致性 11、性能/资源 8、解析边界 9、i18n 2 大块、死代码/结构若干），测试 191 → 202，lint/build 全绿。剩余可选项：§4.10 bootstrap/theme 结构重构、§6.7 delimiterCells 加固、错误文案迁移、images/service 与 api 并发语义的集成测试补强。

### 第五轮核对（2026-08-24）

复核第四轮代码后补齐以下遗漏：

- `api.update()` / `patchFrontmatter()` 将读取时的编辑器快照传入写入阶段；即使传入 `force: true`，快照之后出现的新输入也会返回 `WRITE_CONFLICT`，不再被覆盖。
- API 写入 tab 和侧边栏时均透传 `cleanupImages`；正文未变化但请求清理图片时不再提前返回。
- `trash()` 删除附件前会等待并关闭对应的侧边栏编辑会话，避免 autosave 在删除后重新写回文件。
- 外链图片下载改为流式读取并执行响应体大小上限，超限时取消 reader；超时覆盖响应体读取阶段。
- kebab 菜单的查找快捷键按平台显示 `⌘F` 或 `Ctrl+F`，不再向 Windows 用户显示 macOS 符号。

新增回归测试后，`pnpm test:unit` 为 **210 例全绿**；`pnpm lint:check` 与 `pnpm build`（含 `tsc --noEmit`）均通过。

仍未处理且不影响本轮修复正确性的项目：§4.10 bootstrap/theme 结构重构、§6.7 `delimiterCells` 加固、错误诊断文案的完整 i18n、超大文档渲染限流，以及 API/图片导入的 Zotero 集成测试。
