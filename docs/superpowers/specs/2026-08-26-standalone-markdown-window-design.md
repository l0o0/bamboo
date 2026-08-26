# Markdown 独立窗口与侧边栏打开菜单设计

> 状态：设计已确认
> 日期：2026-08-26
> 相关：
>
> - `DESIGN.md`
> - `docs/superpowers/specs/2026-08-16-sidebar-editor-design.md`
> - `docs/superpowers/specs/2026-08-17-markdown-tab-outline-sidebar-design.md`

## 1. 背景与目标

Bamboo 当前可以在 Zotero 标签页和条目侧边栏中编辑 Markdown，并通过
`DocumentSyncRegistry` 在同一附件的多个视图之间按焦点刷新。新建 stored
Markdown 附件时，临时导入文件名仍包含过长的
`zotero-markdown-<timestamp>-` 前缀；侧边栏也缺少把当前文档打开到独立窗口的入口。

本次目标：

- stored Markdown 的实际文件名采用紧凑的 `zmd-{初始文件名}.md` 格式。
- 提供复用现有 tab 编辑器 iframe 的独立 Markdown 窗口。
- 同一附件在整个 Zotero 进程中最多打开一个独立窗口。
- 侧边栏烤肉串菜单首版只提供“在标签页打开”和“在单独窗口打开”。
- tab、侧边栏和独立窗口可以同时显示同一附件，并保持现有焦点刷新语义。

## 2. 非目标

- 不创建第二套 Markdown 编辑器或新的渲染协议。
- 不支持同一附件同时打开多个独立窗口。
- 不实现跨设备或多人实时协同编辑。
- 不在本阶段向侧边栏烤肉串菜单加入文档信息、导出或设置。
- 不修改现有 CSS 类名和 CodeMirror iframe 的资源路径。

## 3. 方案选择

### 3.1 采用方案

新增一个轻量 Zotero chrome 窗口作为编辑器宿主，并把 tab 当前负责的编辑器
surface 生命周期收敛为 tab 与独立窗口共享的控制器。独立窗口复用同一套：

- toolbar、目录、编辑区和状态栏 DOM
- CodeMirror iframe 与 editor protocol
- 保存、标题同步、图片导入与清理
- More menu、文档弹窗和设置弹窗
- `DocumentSyncRegistry` 焦点同步

窗口宿主只负责创建窗口、提供挂载节点、同步窗口标题及处理关闭，不复制编辑器逻辑。

### 3.2 未采用方案

| 方案                         | 不采用原因                                             |
| ---------------------------- | ------------------------------------------------------ |
| 新开 Zotero 主窗口并添加 tab | 资源占用高，且用户看到完整 Zotero 界面，不是独立编辑器 |
| 普通网页弹窗与主窗口转发消息 | 权限、生命周期和关闭保存链路更脆弱                     |
| 复制一份 tab 实现到窗口模块  | 容易让保存、图片和同步行为逐渐分叉                     |

## 4. 文件命名

### 4.1 对用户可见的名称

设现有标准化文档文件名为 `{filename}.md`：

- stored 附件中的实际主文件名：`zmd-{filename}.md`
- Zotero 附件 item title：仍为 `{filename}.md`
- frontmatter `title` 与首个 H1：仍为 `{filename}`，不添加 `zmd-`

示例：

| 输入文档名                 | stored 文件名                  | item title                 |
| -------------------------- | ------------------------------ | -------------------------- |
| `Note-2026-08-26-21-30.md` | `zmd-Note-2026-08-26-21-30.md` | `Note-2026-08-26-21-30.md` |
| `研究计划.md`              | `zmd-研究计划.md`              | `研究计划.md`              |

若输入已经带有 `zmd-`，不重复添加前缀。扩展名只保留一个 `.md`。

所有编辑器 UI 使用逻辑名称，即 item title：tab 标题、侧边栏标题、独立窗口标题和
重命名输入框均不显示 `zmd-`。物理名称只在“文档信息”的文件路径中如实显示。

显式“重命名”接收逻辑文件名 `{newName}.md`，同时执行：

- 物理文件重命名为 `zmd-{newName}.md`
- item title 更新为 `{newName}.md`
- 所有已打开视图重新解析该 item 的当前路径并刷新显示标题

首个 H1 / frontmatter 的自动标题同步只更新 item title，不重命名物理文件，继续遵守
现有“输入过程中不移动文件”的安全约束。

### 4.2 并发与临时目录

时间戳和短随机串只用于唯一临时目录，例如：

```text
<zotero-temp>/bamboo-<timestamp>-<random>/zmd-{filename}.md
```

`Zotero.Attachments.importFromFile` 复制的 basename 因此稳定为
`zmd-{filename}.md`。无论导入成功或失败，均在 `finally` 中删除整个临时目录。

## 5. 共享编辑器 surface

### 5.1 边界

从 tab 模块中提取可复用的 editor surface/controller。其输入至少包括：

- attachment item
- 宿主 `Window` 与挂载元素
- 稳定且唯一的 `sourceID`
- 初始文档内容、路径和存储类型
- surface 类型：`tab` 或 `window`
- 标题变化、关闭请求等宿主回调

其输出提供：

- `focus()`
- `refreshOnFocus()`
- `flush(options)`
- `destroy()`
- 当前文档标题变化通知

tab 仍由 `Zotero_Tabs` 创建和选择；独立窗口由窗口注册表创建和聚焦。两者只在宿主生命周期上不同。

### 5.2 会话标识

- tab source：沿用 `tab:<tabID>:<itemID>` 语义。
- sidebar source：沿用 `sidebar:<window>:<itemID>` 语义。
- independent window source：使用稳定的 `window:<windowID>:<itemID>`。

每个 source 独立持有编辑器快照与 `SaveCoordinator`，但不在全局同步中心长期缓存正文。

## 6. 独立窗口

### 6.1 创建与单例

引入进程级 `MarkdownWindowRegistry`，以 attachment `itemID` 为键保存：

- 窗口引用
- 初始化中的 Promise
- 对应 editor surface/controller
- 关闭中的 Promise

打开流程：

1. 校验 item 仍存在、是 Markdown attachment 且文件路径可读。
2. 若注册表中存在可用窗口，调用 `focus()` 并触发 `refreshOnFocus()`。
3. 若窗口正在初始化，复用同一个 Promise，初始化完成后聚焦。
4. 若窗口正在关闭，等待关闭完成，再创建新窗口。
5. 否则创建 chrome 独立窗口，并在 DOM ready 后挂载共享 editor surface。

这保证同一文件在整个 Zotero 进程中最多存在一个独立窗口。

### 6.2 窗口界面

独立窗口显示 tab 的完整编辑体验：

- 顶部 toolbar
- 可折叠目录
- Live / Source / Preview 编辑区
- 底部字数、行数和保存状态
- tab More menu 和 modal 功能

窗口标题使用 Markdown 附件的逻辑 item title；首个 H1 同步更新附件标题后，也同步
更新独立窗口标题。窗口初始内容区域为 `1024 x 760` CSS px，设置最小尺寸
`640 x 480`，并允许用户缩放、最大化和调整大小。

### 6.3 焦点与关闭

- 窗口获得焦点时调用现有 `DocumentSyncRegistry.refreshOnFocus()`。
- 如果其他视图有未保存修改，同步中心先 flush 最新 dirty peer，再刷新独立窗口。
- 独立窗口自身 dirty 时不被外部内容覆盖。
- 用户首次关闭窗口时同步取消原生关闭，进入 `closing` 状态，禁用重复关闭请求；随后
  强制保存并请求清理未引用图片。成功后设置内部 `allowClose` 标志，再次调用
  `window.close()`，最后销毁 iframe、modal、监听器和同步 source。
- 保存失败时清除 `closing` 状态并阻止静默丢失：保留窗口、恢复可编辑状态并显示现有
  保存失败状态，用户可保存后重试关闭。
- 插件停用或 Zotero 退出时，统一 flush 并关闭所有 Bamboo 独立窗口。

## 7. 侧边栏烤肉串菜单

### 7.1 Toolbar 调整

- 移除侧边栏左侧现有的“在标签页打开”快捷按钮。
- 保留已有常用 Markdown 格式按钮。
- 右侧烤肉串按钮继续右对齐。

### 7.2 菜单内容

首版菜单仅包含两个命令：

1. 在标签页打开
2. 在单独窗口打开

菜单采用 Zotero 原生风格的紧凑弹层：一列、无分类标题、无嵌套菜单。点击外部、按
`Escape` 或执行命令后关闭；键盘可聚焦和激活菜单项。

行为：

- “在标签页打开”调用现有 `openMarkdownTab`。已打开时选择并刷新已有 tab。
- “在单独窗口打开”调用窗口注册表。已打开时聚焦并刷新已有窗口。
- 命令执行失败时使用本地化错误提示，不保留失效菜单。

## 8. 多视图一致性

允许以下视图同时存在：

```text
sidebar + tab + one independent window
```

同步继续采用已确认的低开销策略：

- 输入时仅当前视图持有本地 dirty 状态并执行防抖保存。
- 保存后递增文档 revision，不广播整篇正文。
- 另一个视图获得焦点时再按 revision 读取磁盘并刷新。
- dirty 目标不被覆盖；存在 dirty peer 时先 flush 最新编辑来源。

独立窗口不会引入常驻正文副本，因此额外内存主要来自一个编辑器 iframe 和其
CodeMirror state，而不是全局文档缓存。

## 9. 本地化与错误处理

新增 en-US 与 zh-CN Fluent 文案：

- 在单独窗口打开
- 独立窗口初始化失败
- 文档已不存在
- 关闭前保存失败

窗口和侧边栏均通过现有 `getString()` 访问本地化文本，不写死中英文。

## 10. 测试与验收

### 10.1 自动化测试

- 文件名 helper：前缀、扩展名、Unicode、重复 `zmd-`。
- 临时目录：两个并发创建不共用路径，清理目标只限本次临时目录。
- 窗口注册表：同 item 单例、不同 item 并存、初始化复用、关闭后可重开。
- editor surface：tab 与窗口使用不同 sourceID，但相同保存和同步接口。
- 焦点同步：tab 修改保存后，独立窗口聚焦得到新内容，反向亦然。
- 关闭：dirty 窗口完成保存和图片清理后才释放注册。
- 侧边栏：移除旧快捷按钮，烤肉串菜单只含两个已本地化动作。

### 10.2 手工验收

1. 新建 Markdown，确认 storage 主文件名为 `zmd-{初始文件名}.md`，item title 不带 `zmd-`。
2. 从侧边栏分别打开 tab 和独立窗口，三个视图可同时显示。
3. 连续点击“在单独窗口打开”，始终只有一个窗口，已有窗口被置前。
4. 在 tab 修改并保存，切换到独立窗口时内容刷新；反向操作同样成立。
5. dirty 视图切换焦点时不丢失内容。
6. 关闭独立窗口后再次打开，内容完整且注册表无残留。
7. macOS、Windows 和 Linux 下窗口可调整大小，toolbar 与正文不重叠。
