# Live Preview 中间编辑区设计

> 状态：L1/L2 已实现（待实机验收）  
> 日期：2026-08-11  
> 相关：`docs/editor/codemirror-iframe-plan.md`、`docs/superpowers/plans/2026-08-11-live-preview.md`

## 1. 背景

v0.1.0 已将 Markdown 源码编辑从 XUL `textarea` 迁到 **chrome iframe + CodeMirror 6**，具备语法高亮、主题热切换与 postMessage 协议桥。

产品目标进一步对齐原型与 **Obsidian Live Preview**：中间编辑区以「文档感」为主，而不是全程 IDE 源码墙。左右边栏不在本设计范围。

## 2. 目标

### 2.1 体验目标

| 模式 | 行为 |
|------|------|
| **live（默认）** | 无光标的行：按 Markdown 渲染（标题字号、列表符号、强调/链接等）。**光标所在行（及选区覆盖的行）显示该行 source**（`#`、`-`、`**` 等可见可改）。 |
| **source** | 全文源码编辑（可保留行号、等宽），用于 frontmatter、排错、对照 raw。 |

- 磁盘真相始终是完整标准 Markdown 字符串（含 YAML frontmatter）。
- 与现有 autosave、dirty、工具栏、主题热切换兼容。

### 2.2 非目标（本阶段）

- 左右文件树 / 大纲边栏
- 块级「整段/整个列表」露源码（方案 B，已否决）
- Typora 式几乎永不露语法
- 表格就地编辑、任务列表、脚注的完整支持
- 图片 `zotero://attachment/...` 解析与插入
- Callout / 可编辑流程图
- 替换为 Milkdown/TipTap 作为主引擎（本阶段不采用）

## 3. 产品决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 产品形态 | Obsidian 式 Live + 可切 Source | 兼顾写作体验与 raw 可控 |
| 露源码粒度 | **行级（方案 A）** | 更跟手；大列表不会整坨变源码 |
| 实现引擎 | 继续 **CodeMirror 6 + Decoration** | 文档真相仍是纯文本；与现有 iframe/协议连续 |
| 不选 ProseMirror 主路径 | 暂缓 Milkdown 等 | 焦点露源码更贴 CM 装饰模型，避免双引擎往返成本 |

## 4. 行级 Live Preview 规则

### 4.1 活跃行

- **活跃行** = 主光标所在 document line，以及选区覆盖的所有 line（`\n` 分隔，CodeMirror line）。
- 活跃行：**不应用** live 装饰 → 用户看到并编辑 source。
- 非活跃行：应用 live 装饰（结构 + 行内）。
- IME 组合输入期间：当前行保持 source，避免装饰与 composition 冲突。

### 4.2 装饰分层

1. **行级结构**（非活跃行）  
   - ATX 标题：隐藏 `#` 前缀，应用 H1–H6 字号/字重  
   - 列表：隐藏 `-` / `*` / `1.` 前缀，用列表缩进/项目符号样式  
   - 引用：隐藏 `>`，应用引用块样式  
   - 代码围栏行：围栏标记行可弱化；内容行等宽块样式  

2. **行内标记**（非活跃行）  
   - `**bold**` / `*em*` / `` `code` `` / `[text](url)`：隐藏语法字符，保留内容与样式  

3. **活跃行**  
   - 清除该行全部 live 装饰  
   - 可选：保留轻度 syntax highlighting（不隐藏标记）

### 4.3 解析失败

- 某行无法安全解析时：**不装饰该行**，保底显示 source。
- 不为追求渲染而改写用户原文。

### 4.4 Frontmatter

- `---` 包围的 YAML 区域：Live 下**始终按 source 显示**（不渲染成标题/列表），避免误伤元数据。
- 后续可选：折叠为「元数据」一行（L4），不在 L1–L2 范围。

## 5. 架构

```
父 Tab shell
  ├─ 工具栏（格式命令 + 模式：实时预览 | 源码）
  ├─ 状态栏（字数/保存状态）
  └─ editorHost
        └─ iframe chrome://zoteromarkdown/content/editor/
              └─ CodeMirror 6
                    ├─ 文档：纯 Markdown 字符串
                    ├─ livePreview 扩展（Decoration + selection 驱动）
                    ├─ mode: "live" | "source"
                    └─ 既有 theme / keymap / change / save 协议
```

### 5.1 与现有基建的关系

- **保留**：iframe、`editor-protocol`、父侧值缓存、`setTheme`、autosave。
- **扩展协议**（建议）：
  - `init.payload.mode?: "live" | "source"`（默认 `"live"`）
  - `setMode` `{ mode: "live" | "source" }`
  - 既有 `change` / `save` / `wrapSelection` / `prefixLine` 不变语义（操作的是真实 md 文本）。

### 5.2 模式切换

| 模式 | CM 行为 |
|------|---------|
| `live` | 启用 livePreview 扩展；隐藏行号（或极弱 gutter）；正文字体与阅读向排版 |
| `source` | 禁用 live 装饰；可显示行号；等宽字体（接近 v0.1.0） |

切换时保持文档内容与尽量保持光标位置；滚动对齐可后置优化。

### 5.3 与「整页 Preview」的关系

- 产品主路径改为 **Live | Source**。
- 现有只读 Preview：L1 可暂时保留以免回归过大；L2/L3 评估合并或移除，避免三套心智并存。

## 6. UI（仅中间区及相关顶栏）

### 6.1 Live 画布

- 无行号（默认）
- 系统/阅读字体（非强制等宽）
- 舒适行高、合理最大内容宽度（居中可选）
- 主题跟随现有 light/dark 热切换

### 6.2 Source 画布

- 等宽 + 可选行号
- 现有 syntax highlighting

### 6.3 工具栏

- B / I / H1 / H2 / 链接等：继续修改底层 Markdown 文本（与现在 API 一致）。
- 模式切换控件：`实时预览` | `源码`。
- 列表/引用等按钮随 L2 接入。

## 7. 分阶段交付

| 阶段 | 内容 | 验收 |
|------|------|------|
| **L1** | `live`/`source` 模式；行级活跃行露源码；非活跃行：ATX 标题 + 粗斜体装饰；Live 基础排版 | 移动光标可见「当前行 source、邻行渲染」；保存/主题正常 |
| **L2** | 列表前缀、链接、行内代码、引用 | 常见笔记结构可读可编 |
| **L3** | 代码围栏；Live 视觉打磨；工具栏与模式切换对齐原型气质 | 中间区接近产品原型文档感 |
| **L4** | frontmatter 折叠；表格/图片等增强 | 按需 |

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 装饰与 IME/光标冲突 | 活跃行零 live 装饰；composition 期间锁定 |
| 大文档性能 | 优先 viewport 相关装饰；依赖 CM 增量 update |
| 复杂 Markdown 边角 | 失败不装饰；不规范化用户源码 |
| 实现复杂度膨胀 | 严格按 L1→L2 切片；禁止同期做边栏/图片协议 |

## 9. 成功标准（L1 + L2）

1. 打开 `.md` 默认进入 Live，中间呈文档感而非纯 IDE。
2. 光标移到标题行出现 `#` 等标记；移开后恢复标题样式。
3. 编辑、autosave、主题热切换行为不回归。
4. 可一键切换全文 Source。
5. 不引入左右边栏。

## 10. 实现入口（供后续 plan 使用）

| 区域 | 路径 |
|------|------|
| iframe CM 启动 | `src/editor/bootstrap.ts` |
| 主题 | `src/editor/theme.ts` |
| 新建 | `src/editor/live-preview/`（plugin、line widgets、inline marks） |
| 协议 | `src/modules/markdown/editor-protocol.ts` |
| 父桥 | `src/modules/markdown/editor.ts` |
| Tab/工具栏 | `src/modules/markdown/tab.ts`、`styles.ts` |

## 11. 确认记录

- 2026-08-11：用户选择产品形态 **2（Obsidian 式）**，露源码粒度 **A（行级）**，设计草案确认 **ok**。
- 2026-08-11：实现计划确认；子代理 API 不可用时由主会话内联完成 L1–L8 代码路径。

## 12. 实现状态

| 阶段 | 状态 |
|------|------|
| L1 模式 + 标题/强调 + 行级活跃 | 已落地 |
| L2 列表/引用/链接/行内代码 | 已落地 |
| IME composition | 已落地（plugin eventHandlers） |
| 工具栏 Live \| Source \| Preview | 已落地 |
| 实机验收 | 待用户在 Zotero 中验证 |
