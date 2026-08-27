# Markdown 大纲随滚动联动设计

> 状态：设计已确认
> 日期：2026-08-27
> 相关：
>
> - `docs/superpowers/specs/2026-08-17-markdown-tab-outline-sidebar-design.md`
> - `docs/superpowers/specs/2026-08-26-standalone-markdown-window-design.md`

## 1. 背景与目标

Bamboo 当前会提取 Markdown 标题、在大纲中展示层级，并允许点击目录项跳转到正文。活动目录项由编辑器光标位置决定，因此只滚动正文但不移动光标时，大纲高亮不会跟随页面。

本次目标是在 Live、Source 和 Preview 三种模式中，以正文当前滚动位置为准更新活动目录项：

- 正文滚动到新章节时切换大纲高亮。
- 活动目录项滚出大纲视口时，将其以最小位移带回可见区域。
- tab 与独立窗口复用同一套联动逻辑。
- 长文档连续滚动时不重复解析全文，也不产生无意义的跨 iframe 消息。

## 2. 交互语义

活动章节定义为正文顶部基准线已经经过的最后一个标题。基准线位于正文滚动容器顶部；首个标题尚未经过基准线时，使用首个标题作为活动章节。没有标题时活动项为 `null`。

滚动位置优先于光标位置：当光标停留在 A 章节、用户只滚动到 B 章节时，大纲高亮 B。键盘输入和光标移动不会把高亮强制切回屏幕外的章节；如果光标移动导致编辑器自动滚动，随后的 viewport 更新自然切换活动章节。

点击大纲项继续执行现有平滑跳转。跳转期间由真实滚动位置持续更新高亮，不引入临时锁或延时猜测。大纲自身只在活动项不可见时执行 `scrollIntoView({ block: "nearest" })`，避免每次切换都强制居中或产生明显抖动。

## 3. 架构

### 3.1 共享活动标题计算

保留现有 `activeOutlineID(items, position)` 作为 Markdown offset 到活动标题的纯计算函数。新增一个明确的滚动位置入口：接收正文顶部对应的文档 offset，计算 active ID，并仅在 ID 改变时发布 `outlineActive`。

编辑器 iframe 和 Preview 宿主采用各自可靠的位置来源，但输出相同的 active ID：

```text
CodeMirror viewport top ─┐
                         ├─ active outline ID ─ host session ─ outline sidebar
Preview heading geometry ┘
```

大纲组件不关心当前模式，也不读取正文滚动状态，只负责渲染、高亮、导航和保持活动项可见。

### 3.2 Live 与 Source

CodeMirror 是虚拟化编辑器，不能依赖标题 DOM 是否存在。使用 `EditorView.updateListener` 的 `viewportChanged` 信号，在滚动或几何变化导致 viewport 更新时读取 `view.viewport.from`，再调用 `activeOutlineID()`。

为避免 viewport 起点落在长行、折叠块或装饰边界带来的偏差，位置统一钳制到文档范围。标题列表仍只在文档变化后通过现有防抖流程重新提取；纯滚动不会调用 `extractEditorOutline()`。

滚动更新通过 `requestAnimationFrame` 合并。同一帧内多次 viewport 变化只计算一次，active ID 不变时不发送父窗口消息。初始化、模式切换及文档标题列表更新完成后立即按当前 viewport 计算一次。

### 3.3 Preview

Preview 已为渲染后的标题设置 `data-zmd-outline-id`。在 Preview 容器上监听滚动，按标题相对滚动容器顶部的位置选择最后一个越过基准线的标题；尚无标题越过时选择首个标题。

计算只遍历标题元素，不遍历正文节点。滚动事件同样由 `requestAnimationFrame` 合并，并仅在 active ID 改变时更新 session 和大纲。Preview 每次重新渲染、切换进入 Preview、图片加载改变文档高度后，下一次滚动或显式刷新重新计算位置。

Preview 监听器和待执行的 animation frame 由 session 生命周期管理，在模式离开、重新渲染和 session 销毁时清理，避免旧 DOM 回调覆盖新页面状态。

## 4. 数据流

### 4.1 Live / Source

1. CodeMirror viewport 变化。
2. animation frame 读取当前 `view.viewport.from`。
3. 使用缓存的 outline items 计算 active ID。
4. ID 变化时通过现有、带 channel 的 `outlineActive` 协议发送给父窗口。
5. session 更新 `outlineActiveID`，大纲切换 `aria-current` 和高亮。
6. 活动按钮不可见时，大纲以 `nearest` 方式滚动自身列表。

### 4.2 Preview

1. Preview 容器滚动或 Preview 完成渲染。
2. animation frame 比较各标题与容器顶部基准线。
3. 得到 active ID，直接更新当前 session 和大纲。
4. 大纲保持活动按钮可见。

## 5. 边界与错误处理

- 空文档或无标题文档返回 `null`，大纲不保留旧高亮。
- 首个标题之前选择首个标题，避免正文顶部出现“没有当前位置”的闪烁。
- 文档编辑导致标题 ID/offset 改变时，以新标题列表重新计算，不复用不存在的 active ID。
- Preview 标题 DOM 与 outline items 数量暂时不一致时，只使用实际存在且带 ID 的标题；找不到有效标题则返回 `null`。
- 大纲折叠或因窄窗口自动隐藏时仍可更新 active ID，但不触发自身滚动；再次显示时同步当前高亮并保证其可见。
- session 正在关闭或 DOM 已断开时，待执行回调直接退出。
- 滚动联动不触发正文保存，不修改 selection，也不调用正文跳转 API，因此不会形成正文与目录之间的滚动反馈循环。

## 6. 性能约束

- 纯滚动不得重新解析 Markdown 语法树。
- 每个 animation frame 最多计算一次活动标题。
- active ID 未变化时不跨 iframe 发消息、不重写大纲 class。
- Live / Source 的查找基于已排序 outline items，可使用现有线性查找；若性能测试显示超长文档存在瓶颈，再替换为二分查找，本阶段不提前增加复杂度。
- Preview 只扫描标题元素，数量与大纲项一致。

## 7. 测试与验收

### 7.1 自动化测试

- offset 位于首个标题之前、标题之间和最后一个标题之后时返回正确 active ID。
- CodeMirror viewport 变化会调度活动标题更新，selection-only 变化不再作为滚动高亮依据。
- 连续 viewport 更新被合并，active ID 不变时不重复发送 `outlineActive`。
- 文档变化重新提取标题后，按当前 viewport 重新计算 active ID。
- Preview 标题几何计算覆盖顶部、章节之间、底部、空标题列表和失效 DOM。
- 模式切换进入 Preview 后立即同步活动目录。
- 大纲活动项只在不可见时使用 `block: "nearest"` 滚入自身视口。
- 大纲折叠或自动隐藏时不滚动自身列表。
- tab 与独立窗口继续通过相同 session/editor surface 接收 active ID。

### 7.2 手工验收

1. 在包含多级标题的长文档中只滚动、不移动光标，确认大纲高亮随章节切换。
2. 分别在 Live、Source、Preview 中验证顶部、中间和文档末尾。
3. 快速连续滚动，确认高亮稳定且编辑器无明显卡顿。
4. 滚动到大纲列表视口之外的章节，确认活动目录项以最小位移进入可见区域。
5. 点击远处目录项，确认正文平滑跳转，高亮随真实滚动过程切换并最终停在目标项。
6. 编辑、删除和新增标题后继续滚动，确认不存在旧目录高亮。
7. 在 Zotero tab 和独立 Markdown 窗口中重复以上行为。
