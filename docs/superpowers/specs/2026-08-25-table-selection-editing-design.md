# Markdown Live 表格选择与编辑设计

## 背景

Bamboo 当前已经支持 Live 模式下的 GFM 表格渲染、单元格编辑、行列插入/删除/移动、对齐和边缘拖拽排序。表格边缘的三点按钮目前只承担拖拽入口，拖拽结束后高亮会被清除；右键菜单只针对当前单元格生成单个 `TableTarget`，没有持久的行列选择状态；Delete 键也不会删除已选择的行或列。

本设计补充 Obsidian 风格的表格选择交互，优先解决整行/整列选择、视觉反馈、键盘删除和核心右键菜单。单元格范围拖选和完整文本格式子菜单不纳入第一阶段。

## 目标与非目标

### 目标

- 点击行或列的三点按钮后，保持对应整行或整列的逻辑选中状态。
- 选中状态在 Live Preview 重绘、文档前方插入内容、撤销/重做后保持正确或被安全清除。
- 选中行/列时，表格单元格和对应 handle 都有稳定、可辨识的高亮。
- 点击其他编辑区域后清除选择；点击另一个 handle 时切换选择。
- 选中 body row 或 column 后按 `Delete` 删除对应行/列。
- 删除后自动选中相邻的可用行/列，边界条件不会破坏 Markdown 表格。
- 右键菜单可以识别当前整行/整列选择，并提供核心表格操作。
- 既有单元格编辑、Tab 导航和行列拖拽行为保持可用。

### 非目标

- 第一阶段不实现拖拽框选任意矩形单元格区域。
- 第一阶段不实现跨多个不连续行/列的多选。
- 第一阶段不改变 Markdown 表格序列化格式以外的文档内容。
- 第一阶段不实现完整的文本格式二级菜单；加粗、倾斜、删除线、代码等作为后续阶段。

## 现状约束

- `src/editor/live-preview/plugin.ts` 负责生成表格 cell widget、行/列 handle 和新增行列按钮。
- `src/editor/bootstrap.ts` 负责 iframe 内的运行时状态、CodeMirror 事件、键盘绑定和右键菜单动作。
- `src/editor/table.ts` 提供表格布局、逻辑行列索引和稳定 cell 身份。
- `src/editor/table-operations.ts` 已经提供插入/移动/删除/对齐的单目标 operation plan，并保护表头行和最后一列。
- `src/editor/table-menu.ts` 已经提供菜单容器、分组、禁用态和定位逻辑。
- 当前 row/column handle 的 pointer 事件默认启动拖拽；实现选择时必须区分点击和拖拽，不能牺牲现有排序功能。
- Live Preview 的 cell 是 CodeMirror replacement widget，视觉选择不能依赖一次性的 DOM 查询结果。

## 方案

### 选择状态模型

新增 `src/editor/table-selection.ts`，集中定义选择状态和纯逻辑操作：

```ts
export type TableSelection =
  | { kind: "row"; tableFrom: number; rowIndex: number }
  | { kind: "column"; tableFrom: number; columnIndex: number }
  | null;
```

`tableFrom`、`rowIndex` 和 `columnIndex` 是逻辑身份；不保存 cell 的当前文本 offset。模块提供以下能力：

- `sameTableSelection(a, b)`：比较选择身份，避免无意义重绘。
- `selectionContainsCell(selection, rowIndex, columnIndex)`：判断 cell 是否应该高亮。
- `remapTableSelection(selection, changes, nextState)`：在文档变更后映射 table 起点，并使用 `tableLayoutAt` 验证目标仍存在；目标表格或目标行列消失时返回 `null`。
- `selectionAfterDelete(selection, nextLayout, deletedIndex)`：计算删除后的相邻选择。
- `selectionTarget(selection, layout)`：为菜单和批量 operation 转换成行/列范围。

选择状态只存在于当前 iframe 编辑器实例，不写入文档、不参与保存协议。

### CodeMirror 与 Live Preview 集成

在 `src/editor/live-preview/plugin.ts` 中新增 `setLiveTableSelection` StateEffect，并让 `LivePreviewPlugin` 持有当前选择。`buildDecorations` 接收选择参数：

- `TableCellWidget` 根据 `selectionContainsCell` 添加 `zmd-lp-table-cell-selected`。
- `TableEdgeActionsWidget` 给匹配的 row/column handle 添加 `is-selected`、`aria-pressed="true"` 和稳定的可见状态。
- 选择变化只触发必要的 decoration 重建；没有选择时维持当前渲染路径。

在 `bootstrap.ts` 中保存 `runtime.tableSelection`，所有选择变化通过统一的 `setTableSelection(next)` 函数完成：

1. 更新 runtime 状态。
2. dispatch `setLiveTableSelection` effect。
3. 清除当前 cell editing 状态（选择 handle 时不进入 cell 编辑）。
4. 保持编辑器焦点，必要时关闭已打开的右键菜单。

文档变更时，如果不是选择操作本身产生的 effect，使用 `ChangeDesc.mapPos` 映射 `tableFrom`，再调用 `remapTableSelection`；映射失败时清除选择。

### 点击与拖拽判定

将现有 `TableDragSession` 扩展为 handle pointer session：

- `pointerdown` 保存 pointerId、kind、tableFrom、index 和起点坐标，但不立即执行排序。
- 移动距离超过 4px 才进入当前的 row/column reorder 流程，并继续显示 drag source/drop target 高亮。
- `pointerup` 未超过阈值时视为普通点击：调用 `setTableSelection`。
- `pointercancel` 清理 session 和临时拖拽高亮。
- row handle 仍只出现在 body row；column handle 仍出现在 header row。
- read-only 编辑器不创建可操作的 selection handle，也不拦截 Delete。

点击处理规则：

- 点击另一个 row/column handle：切换到新选择。
- 点击表格 cell：清除行列选择，然后沿用现有 cell 激活和编辑逻辑。
- 点击表格外的编辑区域：清除选择。
- 右键点击当前已选范围内的 cell：保留选择并以该选择生成菜单。
- 右键点击其他 cell：关闭旧选择，使用当前 cell 作为一次性菜单 target，不伪造整行/整列高亮。

### Delete 键与批量操作

在 CodeMirror 高优先级 keymap 中增加 selection handler，优先级高于普通编辑和 cell 输入：

- `row` selection：调用新的 `planTableSelectionOperation(state, selection, "delete")` 删除 body row。
- `column` selection：调用同一入口删除 column。
- 没有 selection 时返回 `false`，不改变现有 Delete 行为。
- 表头没有 row handle，因此不能通过选择按钮删除；最后一列继续拒绝删除。

`table-operations.ts` 增加面向单个逻辑行/列选择的计划函数，而不是在 bootstrap 中拼接 Markdown：

- 复用现有 `editableTable`、`serialize` 和边界保护。
- 一次 operation 只产生一个 CodeMirror change，保留 undo/redo 原子性。
- 返回新的 selection position，以及删除后要保留的 `TableSelection`。
- 清空内容操作只将目标 cell 值替换为空字符串，不移除管道符和表格结构。
- 删除操作在 body row 数为 0 或 column 数为 1 时返回 `null`，由菜单显示 disabled。

删除后的选择规则：

- 删除行：优先选中原位置的下一行，若不存在则选中上一行；没有 body row 时清除。
- 删除列：优先选中原位置的下一列，若不存在则选中新的最后一列。
- 如果 operation 因边界保护失败，保留原选择并不发送 change。

### 右键菜单

扩展 `src/editor/table-menu.ts` 的菜单模型，但保留现有 DOM 菜单容器和定位逻辑。菜单 action 分为三类：

1. **编辑器通用动作**：剪切、复制、粘贴。调用 CodeMirror/DOM 已有的 clipboard 能力；不可用时显示 disabled，不自行复制整份文档。
2. **表格结构动作**：在上/下方插入行、移动行、删除选中行；左/右插入列、移动列、删除选中列。
3. **单元格内容动作**：清空选中的单元格、左/中/右对齐。

菜单根据 `TableSelection` 生成：

- row selection 显示 row 相关删除/移动项，清空作用于整行。
- column selection 显示 column 相关删除/移动项，清空和对齐作用于整列。
- 无 selection 时保留现有单 cell target 菜单，结构操作仍作用于当前 cell 所在行/列。
- 删除选中行/列和清空选中单元格的 label、disabled 状态根据边界实时计算。
- 菜单点击后执行一个 operation plan，关闭菜单，保留或更新 selection，并重新聚焦编辑器。

为后续文本格式子菜单预留 `submenu` 数据结构，但第一阶段不加入具体格式 action。后续格式化必须以 cell 内容为输入逐格转换，不能对整段 Markdown 进行正则替换。

### 视觉样式

在 `src/editor/theme.ts` 增加 selection tokens 和 class：

- `.zmd-lp-table-cell-selected`：使用背景色和 `box-shadow: inset 0 0 0 2px ...`，不改变网格尺寸。
- `.zmd-lp-table-row-handle.is-selected`、`.zmd-lp-table-column-handle.is-selected`：opacity 为 1，使用 accent 背景/边框，并显示 `aria-pressed` 对应的 focus ring。
- 选择态优先级高于普通 active cell 和 drag source，但拖拽中的 source/drop target 仍临时覆盖选择态，拖拽结束后恢复 selection。
- light/dark 主题均使用现有 accent、selection 和 table token，不新建单一色系。
- 所有按钮维持稳定尺寸，避免高亮时改变表格列宽或行高。

## 数据流

```text
handle pointerdown
  -> pointer session
  -> click threshold
       -> setTableSelection
       -> setLiveTableSelection effect
       -> live-preview rebuilds selected cells/handles

Delete / menu action
  -> selection operation plan
  -> one CodeMirror transaction
  -> remap or compute next selection
  -> render highlight + publish document change
```

选择状态不经过 parent iframe message，也不触发保存。文档 change 仍按现有 protocol 发给父级；tab/sidebar 的文档同步只同步 Markdown 内容，不同步临时选择状态。

## 错误处理与边界

- table 起点被删除、表格解析暂时不完整或 row/column 索引超界时，清除 selection，不抛异常。
- 文档变更期间菜单 target 失效时，菜单 action no-op 并关闭菜单。
- read-only 或 source 模式不显示交互式 handle，不响应 selection Delete。
- 不规则表格按现有 `editableTable` 规则补齐缺失 cell；清空/删除不得丢失其他行的管道符和对齐分隔行。
- 菜单定位继续沿用 viewport clamp，避免窄窗口溢出。
- pointer 事件、菜单事件和键盘事件都必须在 editor destroy 时移除，避免 tab/sidebar 重复注册。

## 测试计划

新增 `test/editor-table-selection.test.ts`，覆盖：

- row/column selection 的创建、切换、清除和相等判断。
- 文档前方插入、表格删除、行列越界后的 remap 行为。
- 删除行/列后的相邻选择和边界保护。
- selectionContainsCell 对 header/body/ragged row 的判断。

扩展 `test/editor-table-operations.test.ts`：

- 删除整行、整列只生成一个 change。
- 清空整行/整列保留 Markdown 表格结构。
- 不规则表格、空 cell、escaped pipe 和对齐信息均保持正确。

扩展 `test/editor-table-menu.test.ts`：

- row/column selection 下菜单 action、label 和 disabled 状态。
- 最后一列、空 body、只读模式的菜单保护。
- 无 selection 时维持现有 cell target 菜单行为。

若运行时测试 harness 可复用，再增加 pointer click-vs-drag 和 Delete key 的事件测试；否则通过纯逻辑测试覆盖判定函数，并在手工验收中验证浏览器交互。

## 分阶段交付

### 阶段一

- `TableSelection` 状态和 remap。
- 行列 handle 点击选择、点击外部清除。
- 选择态 cell/handle 样式。
- Delete 删除选中行/列。
- 核心右键菜单：清空、删除、插入、移动、对齐及剪切/复制/粘贴入口。
- 纯逻辑和 operation/menu 测试。

### 阶段二

- 文本格式二级菜单。
- 单元格范围拖选或多选。
- 更完整的 clipboard 表格格式转换（TSV/Markdown table）。

## 验收标准

1. 点击三点按钮后，整行或整列持续高亮，按钮也保持高亮。
2. 点击另一个位置后旧高亮消失；点击另一个 handle 后切换到新选择。
3. 普通点击与拖拽排序都能正确识别。
4. 选中行/列后按 Delete 只删除对应结构，普通 cell 编辑 Delete 不受影响。
5. 右键菜单作用于当前选择，边界项正确 disabled，菜单不破坏现有单元格编辑。
6. Live/Source 切换、撤销/重做、文档同步和 tab/sidebar 切换后不会残留失效高亮。
7. light/dark 主题下高亮清晰，表格尺寸和布局不跳动。
