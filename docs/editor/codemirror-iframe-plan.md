# CodeMirror iframe 编辑器重构方案

> 状态：实施中  
> 分支：`feature/codemirror-iframe-editor`  
> 日期：2026-08-11

## 1. 背景与目标

### 现状

- 编辑器实现：`src/modules/markdown/editor.ts`
- 使用 XUL/HTML 混合文档下的原生 `textarea` + 外置行号 gutter
- 注释中明确避开 CodeMirror：在错误 document / 测量坐标系下，CM 虚拟滚动不稳定

### 问题

| 问题 | 影响 |
|------|------|
| 无语法高亮 | 阅读 Markdown 结构成本高 |
| 无撤销栈增强 / 多选 / 搜索 | 编辑体验弱于现代编辑器 |
| 大文件滚动与选区能力有限 | 长笔记体验下降 |
| 扩展能力差 | 后续难以加 lint、补全、折叠等 |

### 目标

1. 用 **CodeMirror 6** 替换 textarea，作为 Markdown **源码**编辑器
2. 通过 **iframe 注入** 提供稳定的纯 Web document，避免在 Zotero chrome 文档里直接挂 CM
3. **对外 API 尽量保持** `MarkdownEditorHandle`，`tab.ts` 工具栏 / autosave / preview 少改
4. 不在本阶段做所见即所得（Milkdown 等），先把源码编辑做稳

## 2. 非目标（本阶段不做）

- 所见即所得 / WYSIWYG
- 图片 `zotero://attachment/...` 解析与插入（后续独立任务）
- 独立浮动编辑窗口
- 回写 Zotero Note HTML
- 完整 Vim / 协作编辑

## 3. 架构

### 3.1 总览

```
┌─ Zotero Tab（现有 HTML shell，父文档）─────────────────────┐
│  toolbar / status / preview（继续在父文档）                  │
│  ┌─ iframe ─────────────────────────────────────────────┐  │
│  │  chrome://zoteromarkdown/content/editor/index.html   │  │
│  │  + editor.js（CodeMirror 6 在 iframe 内完整运行）      │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 3.2 原则（硬约束）

| 原则 | 说明 |
|------|------|
| CM 必须在 iframe 内执行 | 禁止父脚本 `new EditorView` 后挂 iframe 节点 |
| 行号在 iframe 内 | 使用 CM 官方 `lineNumbers()`，禁止父页面外置 gutter 同步滚动 |
| 值缓存在父侧 | `getValue()` 同步读缓存，保证 autosave / 关 tab 不 await iframe |
| 命令可排队 | iframe 未 ready 时 `wrapSelection` 等入队，ready 后 flush |
| 样式增量修改 | 不整文件覆盖 `styles.ts` |

### 3.3 参考实现

- **Garden**（`garden/src/modules/tabManager.ts`）：tab 内 `iframe` + `chrome://.../index.html`
- **zotero-md-editor**：iframe + `postMessage` 数据流
- **本仓库** `ensureDOMGlobals`：说明插件沙箱没有完整浏览器 DOM

## 4. 通信协议

父页面与 iframe 通过 `postMessage` 通信。建议 `source` 固定为 `zotero-markdown-editor`。

### 4.1 父 → 子

| type | payload | 说明 |
|------|---------|------|
| `init` | `{ doc, readOnly, fontSize, theme }` | 初始化或重置文档 |
| `setValue` | `{ value }` | 整文替换 |
| `wrapSelection` | `{ before, after? }` | 包裹选区 |
| `prefixLine` | `{ prefix }` | 当前行加前缀（标题等） |
| `focus` | — | 聚焦编辑器 |
| `requestMeasure` | — | 布局变化后重新测量 |
| `getStats` | `{ requestId }` | 请求统计（可选，父侧也可本地算） |
| `destroy` | — | 销毁 CM 实例 |

### 4.2 子 → 父

| type | payload | 说明 |
|------|---------|------|
| `ready` | — | iframe + CM 就绪，可收 init 之后的命令 |
| `change` | `{ value, stats }` | 文档变更 |
| `save` | — | Cmd/Ctrl+S |
| `focus` / `blur` | — | 焦点变化（可选） |
| `error` | `{ message }` | 初始化失败 |

### 4.3 父侧 `MarkdownEditorHandle`

```ts
export interface MarkdownEditorHandle {
  ready: Promise<void>;
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  destroy: () => void;
  getStats: () => { chars: number; lines: number; words: number };
  wrapSelection: (before: string, after?: string) => void;
  prefixLine: (prefix: string) => void;
  view: {
    requestMeasure: () => void;
    focus: () => void;
    contentDOM: HTMLElement; // iframe 元素
    scrollDOM: HTMLElement;
  };
}
```

实现要点：

1. **lastValue / lastStats**：`change` 时更新；`getValue` / `getStats` 同步返回
2. **pendingCommands**：未 ready 时缓冲命令
3. **destroy**：`postMessage(destroy)` → `view.destroy()`（子）→ 卸 listener → 移除 iframe

## 5. 构建与目录

### 5.1 双入口 esbuild

```
src/index.ts                 → content/scripts/zoteromarkdown.js   （插件主脚本）
src/editor/bootstrap.ts      → content/editor/editor.js            （iframe 内 CM）
addon/content/editor/index.html                                    （iframe 页面）
```

`zotero-plugin.config.ts` 增加第二个 `esbuildOptions` 条目；`assets` 继续打包 `addon/**/*.*`。

### 5.2 依赖

```json
{
  "@codemirror/state": "^6",
  "@codemirror/view": "^6",
  "@codemirror/commands": "^6",
  "@codemirror/language": "^6",
  "@codemirror/lang-markdown": "^6",
  "@codemirror/search": "^6"
}
```

说明：

- 不要依赖错误的 `@codemirror/keymap` 独立包（keymap 在 `@codemirror/view`）
- 主题自写 minimal light/dark，避免强绑 `theme-one-dark`
- **不要**默认引入 `@codemirror/language-data`（会把 editor bundle 撑到数 MB）
- fenced code 块第一阶段保持纯文本高亮即可

### 5.3 源码布局

```
src/
  editor/
    bootstrap.ts          # iframe 入口：创建 CM、收发 postMessage
    theme.ts              # 明暗主题 extension
    keymap.ts             # 快捷键（save / bold 等可放这）
  modules/markdown/
    editor.ts             # 父侧：创建 iframe + 协议桥（替换原 textarea）
    editor-protocol.ts    # 消息类型定义（可选）
    tab.ts                # 尽量少改；create 后 await ready 可选
    tabHooks.ts           # refocus 选择器改为 iframe / host
    styles.ts             # 增量：iframe 撑满 host
```

## 6. iframe 挂载细节

### 6.1 创建顺序

1. 在 `editorHost` 内创建 `iframe`（建议 HTML namespace，与现有 UI 一致）
2. 设置样式：`width/height 100%`、`border: none`、`flex: 1`、`min-height: 0`
3. `src = chrome://zoteromarkdown/content/editor/index.html`
4. 监听 `load` → 等待子页 `ready` 消息（或 load 后直接 `init`，子页幂等处理）
5. `postMessage(init, ...)`
6. flush 命令队列

### 6.2 与 Garden 的差异

Garden 使用 XUL `iframe` + `type="content"`。  
本插件 tab 内容已是 HTML shell（`namespace: "html"`），**优先 HTML iframe**；若高度/焦点异常，再试 XUL iframe。

### 6.3 生命周期

| 事件 | 行为 |
|------|------|
| 打开 tab | 创建 iframe + init |
| 编辑 | change → dirty + autosave |
| 工具栏 B/I/H/Link | wrapSelection / prefixLine |
| Preview | 父侧读 getValue 渲染；iframe 可 `display:none`，切回 edit 时 requestMeasure |
| 关闭 tab | destroy + flush save（现有逻辑） |
| 多窗口 | session 带 `win`，iframe 必须挂在对应 window 的 document |

## 7. CodeMirror 配置（iframe 内）

最低 extension 集：

- `markdown({ codeLanguages: languages })`（`@codemirror/lang-markdown` + `language-data`）
- `history()` + `defaultKeymap` + `historyKeymap`
- `lineNumbers()`、`highlightActiveLine()`、`highlightActiveLineGutter()`
- `EditorView.lineWrapping`
- `indentWithTab` 或等价 Tab 插入空格
- `EditorView.updateListener` → 向父发 `change`
- `EditorState.readOnly` / `EditorView.editable.of(!readOnly)`
- 自定义 keymap：Mod-s → save；Mod-b / Mod-i / Mod-k；Mod-1/2/3 标题（可与工具栏并存）

## 8. 分阶段实施

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | 设计文档、双入口、空 editor 页、iframe 能加载 | 打开 md 可见 iframe 内容 |
| **P1** | iframe 内 CM 可编辑；change → dirty / autosave | 保存与现网一致 |
| **P2** | 工具栏 / 快捷键桥接；stats；readOnly | B/I/H/Link 正常 |
| **P3** | 主题跟随、fontSize pref、中文 IME、大文件 | 中文输入不丢字 |
| **P4** | 删除 textarea 残留 CSS / 选择器 | 无回归 |

## 9. 否决的错误做法

以下方案在评审中否决，**禁止**在实现中出现：

1. 父页面 `import { EditorView }` 后 `new EditorView({ parent: iframeDiv })`
2. 未等 iframe `load` 就读 `contentDocument` 并写入
3. 父页面外置 gutter + 同步 `scrollTop`
4. 用 `view.dom.addEventListener("input")` 代替 `updateListener`
5. `EditorView.lineWrapping.of(true)` 等错误 API
6. 整文件覆盖 `styles.ts` 毁掉 toolbar / preview
7. `getValue` 强制异步 await iframe（破坏现有 save 同步读取）

## 10. 风险与验证清单

- [ ] Tab 内 iframe 高度是否撑满（`flex` + `min-height: 0`）
- [ ] `chrome://` 页面加载插件脚本是否被 CSP 拦截
- [ ] iframe 获焦后 Zotero 全局快捷键是否被吞
- [ ] 多窗口 / 多 tab 实例是否隔离
- [ ] Preview 切换后 CM 布局是否正确
- [ ] 打包体积是否可接受（CM + markdown 语言包）
- [ ] 中文 IME 组合输入是否正常

## 11. 实施记录

| 日期 | 内容 |
|------|------|
| 2026-08-11 | 方案定稿；开始 P0/P1：双入口 + iframe 桥 + CM6 |
| 2026-08-11 | **已落地 P0–P2 骨架**：`editor-protocol`、父侧 `editor.ts` 桥、iframe `bootstrap.ts`+主题、`addon/content/editor/index.html`、双 esbuild 入口、styles/tabHooks；`pnpm build` 通过（editor.js ≈ 541KB minify） |
| 2026-08-11 | **主题热切换**：监听 `prefers-color-scheme` change + `documentElement` MutationObserver；已打开 tab 同步 shell（`theme-dark`/`theme-light`）与 iframe `setTheme` |

### 当前文件映射

| 文件 | 角色 |
|------|------|
| `docs/editor/codemirror-iframe-plan.md` | 本方案 |
| `src/modules/markdown/editor-protocol.ts` | 消息协议 + stats |
| `src/modules/markdown/editor.ts` | 父侧 iframe 桥 |
| `src/editor/bootstrap.ts` | iframe 内 CM6 |
| `src/editor/theme.ts` | 明暗主题 |
| `addon/content/editor/index.html` | iframe 页面 |
| `zotero-plugin.config.ts` | 双入口打包 |

### 待实机验证（P3）

- [ ] Zotero 中打开 `.md` 附件，iframe/CM 是否渲染
- [ ] 编辑 → autosave / 手动 Save
- [ ] 工具栏 B/I/H/Link + 快捷键
- [ ] Preview 切换后 requestMeasure
- [ ] 中文 IME
