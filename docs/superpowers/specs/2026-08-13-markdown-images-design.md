# Markdown 图片存储与同步方案

> 状态：草案（待评审）  
> 日期：2026-08-13  
> 相关：  
> - Zotero Note 图片机制调研（会话结论）  
> - `docs/editor/codemirror-iframe-plan.md`  
> - `docs/superpowers/specs/2026-08-11-live-preview-design.md`

## 1. 背景与目标

### 1.1 背景

后续要在 zotero-markdown 中支持：

- 剪贴板粘贴图片  
- 选择本地图片插入  
- （可选）拖拽插入  
- Live / Preview 中正确显示图片  

Zotero **Note** 的做法是：图片为 `LINK_MODE_EMBEDDED_IMAGE` 子附件，父项必须是 Note，列表层过滤 `isEmbeddedImageAttachment()`，故用户几乎看不见图附件。

我们的文档本体是 **`.md` file attachment**，不是 Note，因此 **不能** 把图挂成 md 的 embedded-image 子项（父项类型校验会失败）。

若在文献下并列创建普通 `IMPORTED_FILE` 图片附件：

- 会进入 item / 附件列表  
- 污染「最佳附件」等逻辑  
- 用户易误删图导致 md 引用断裂  

### 1.2 目标

| 目标 | 说明 |
|------|------|
| 列表干净 | 插图 **不** 新增可见 attachment item |
| 同步可靠 | 在 Zotero Storage / WebDAV 下，图与 md 能一起到其他客户端 |
| 引用稳定 | md 中不写本机绝对路径 |
| 实现可控 | 复用现有 stored 附件 + iframe 编辑器，不改 Zotero 核心 |
| 与 Live 兼容 | 源码 / Live / Preview 均可解析并显示 |

### 1.3 非目标（本阶段）

- 与 Zotero Note HTML 互转时自动迁移图片  
- 图床 / 外链图托管  
- 在 Group 只读库中强制上传  
- 完美双向实时协作冲突合并（按附件整包冲突处理即可）  
- linked-file 型 md 的完整插图支持（见约束）

---

## 2. 方案选择

### 2.1 候选回顾

| 方案 | 列表污染 | 同步 | 结论 |
|------|----------|------|------|
| A. md storage 目录内旁路文件 | 无 | 整目录 zip（见 §5） | **采用** |
| B. 影子 Note + embedded image | 无图 item，多一个 Note | 官方路径 | 不采用（语义怪） |
| C. 同级普通 image 附件 | 有 | 好 | 不采用（污染列表） |
| D. 伪造 EMBEDDED_IMAGE 挂 md | — | — | **不可行**（父项必须是 Note） |

### 2.2 选定：方案 A — 包内资源（sidecar assets）

**对用户：** 库里仍然只有一个 `.md` 附件。  
**对磁盘：** 图片写在该 md 附件的 `storage/<mdKey>/` 目录内，与 `note.md` 并列。  
**对同步：** 不是产品层「用户管理一个 zip」；同步层在上传 **text/\*** stored 附件时会打包整个 storage 目录（见 §5）。

---

## 3. 数据模型

### 3.1 目录布局

```text
{Zotero data}/storage/<mdAttachmentKey>/
  <filename>.md          # 主文件（attachmentPath → storage:xxx.md）
  assets/
    <assetId>.<ext>      # 图片文件
```

约定：

- 资源目录名固定为 **`assets`**（小写）。  
- 资源文件名：`{timestamp}-{shortRandom}.{ext}` 或 UUID，避免冲突；**不使用用户原始文件名**（路径安全、跨平台）。  
- 仅支持 **stored** md 附件（`LINK_MODE_IMPORTED_FILE` 或等价 stored 形态）。  
- md 的 `attachmentContentType` 必须保持 **`text/markdown`**（或以 `text/` 开头）。

### 3.2 Markdown 引用语法

**首选（相对路径，可移植、可读）：**

```md
![可选 alt](assets/<assetId>.png)
```

**可选 scheme（便于解析、避免与用户自写相对路径混淆）：**

```md
![可选 alt](zotero-md://asset/<assetId>.png)
```

规范：

| 项 | 约定 |
|----|------|
| 解析优先级 | `zotero-md://asset/...` → `assets/...` 相对路径 |
| 禁止 | `file://`、绝对路径、`~/...` 写入 md |
| 外链 | `https://...` 可渲染，**不**自动下载入库（本阶段） |
| 尺寸 | 第一期不写 HTML；需要时后续用属性或 HTML 块扩展 |

解析时「当前文档」= 正在编辑的 md attachment；相对路径相对于 **该附件主文件所在目录**（即 storage 根，与 `assets/` 同级）。

### 3.3 与 Zotero Note 对照

| Note | 本方案 |
|------|--------|
| 子 item + `LINK_MODE_EMBEDDED_IMAGE` | **无** 额外 item |
| `data-attachment-key` | `assets/<id>.ext` 或 `zotero-md://asset/...` |
| `importEmbeddedImage` | 写文件到 `storage/<mdKey>/assets/` |
| UI 过滤 embedded | 不需要 |
| `deleteUnusedEmbeddedImages` | 可选 GC：扫 md 删未引用 assets |

---

## 4. 功能设计

### 4.1 插入路径（统一管道）

所有入口汇入同一函数，例如 `insertImageFromBlob(session, blob, options)`：

```text
blob / File
  → 校验 MIME / 大小
  → 确保 md 为 stored 且 contentType 合法
  → resolveStorageDir(mdItem)
  → 写入 assets/<assetId>.<ext>
  → 构造 markdown 片段
  → 编辑器 insert / wrap
  → 标记 dirty + 保存 md（强制，见 Sync 契约）
```

入口：

| 入口 | 说明 |
|------|------|
| 粘贴 | iframe / 父页拦截 `paste`，取 `clipboardData.items` 中 image |
| 选文件 | 工具栏按钮 → 系统文件选择器 |
| 拖拽 | （第二期）`drop` files |

### 4.2 MIME 与扩展名

对齐 Note 常用集合（可先收窄）：

| MIME | 扩展名 |
|------|--------|
| image/png | png |
| image/jpeg | jpg |
| image/gif | gif |
| image/webp | webp |
| image/svg+xml | svg（可选，注意 XSS：Preview 需消毒） |
| image/bmp | bmp（可选） |

拒绝未知类型；超大文件拒绝并提示（建议默认上限如 10–20 MB，可配置）。

### 4.3 渲染

| 模式 | 行为 |
|------|------|
| **Source** | 显示 md 文本；可不内联预览图 |
| **Live** | 非活跃行：将图片语法渲染为 img widget；活跃行：显示 source，可保留占位高度避免跳动 |
| **Preview** | markdown-it 渲染前解析图片 URL 为可读地址 |

解析为可读地址：

1. 取 md item → `getFilePathAsync()` → 父目录  
2. 拼 `assets/<file>`  
3. 若文件存在：  
   - 优先：读文件 → data URL 喂给 iframe（跨权限最稳）  
   - 或：在 chrome 权限允许下用 `file://` / `zotero://` 类 URL（实现时探针）  
4. 若缺失：占位图 +「图片缺失 / 待同步」

### 4.4 删除与 GC

| 行为 | 策略 |
|------|------|
| 用户删除 md 中的图片语法 | 默认 **不** 立即删文件（防误删、利于撤销） |
| 显式「清理未引用图片」 | 扫全部 `assets/*` vs md 引用，删未引用 |
| 删除整个 md 附件 | 由 Zotero 删除 storage 目录，assets 一并消失 |
| 关闭编辑器 | 可选轻量 GC（默认关） |

### 4.5 工具栏

增加「插入图片」按钮（Lucide `image` 图标，与现有工具栏一致），触发文件选择；粘贴不依赖按钮。

---

## 5. 同步契约（硬性）

依据 Zotero 源码（`zfs.js`）：

```js
_isZipUpload: async function (item) {
  return (item.isImportedAttachment()
          && item.attachmentContentType.startsWith('text/'))
      || Zotero.Attachments.hasMultipleFiles(item);
}
```

以及：

- 上传 zip 内容 = **整个** `getStorageDirectory(item)`  
- 变更检测 `attachmentModificationTime` / `attachmentHash` 只看 **主文件**路径，不是整个目录  

### 5.1 必须遵守

1. **md 必须是 stored imported attachment**，`contentType` 以 `text/` 开头（`text/markdown`）。  
2. **任何写 assets 的操作，必须导致主 md 文件变更并保存**（插入/更新引用字符串即可；替换同名图且 md 未变时须 touch 主文件或 `attachmentSyncState = to_upload`）。  
3. **禁止** 只写图、不保存 md。  
4. **禁止** 依赖 linked-file md 的默认路径（产品：插图仅 stored）。  
5. 冲突按 **整附件** 处理；冲突后校验引用与 assets 一致性。

### 5.2 推荐实现细节

| 场景 | 做法 |
|------|------|
| 粘贴插图 | 写 assets → 插入 `![](assets/...)` → autosave/显式 save 主 md |
| 替换图片（路径不变） | 新文件名插入，或写文件后 `IOUtils.setModificationTime` 主 md / 标记 to_upload |
| 仅 GC 删未引用文件 | 同时 touch 主 md 或标 to_upload，否则其他端可能仍带旧 zip 成员（取决于服务端版本；稳妥起见 touch） |

### 5.3 同步探针（实现前必做）

在真实 Zotero + 文件同步环境：

1. A 端：stored md，粘贴图并保存 → 同步 → B 端打开，图可见。  
2. A 端：只替换 png 不改 md、不 touch → 同步 → B 端应 **仍是旧图**（验证风险）。  
3. A 端：替换后 touch md → B 端更新。  
4. 确认 `contentType` 被误设为非 `text/*` 时行为（应避免）。

### 5.4 容量与性能注意

- 图占用文件存储配额。  
- 变更可能重传 **整个** 附件 zip，图多会变慢。  
- 可限制单图大小、单笔记 assets 总大小、单次粘贴张数。

---

## 6. 架构（与现有插件集成）

```text
父 Tab (toolbar: 插图按钮, paste 可选)
        │
        │ postMessage: insertImage / resolveImage / imageMissing
        ▼
iframe Editor (CM Live / Source)
        │
        ▼
MarkdownImageService (插件沙箱，可访问 Zotero API)
  - resolveStorageRoot(mdItem)
  - writeAsset(blob) → relativePath
  - resolveToDisplayURL(relativePath) → dataURL | error
  - listAssets / gcUnused
        │
        ▼
Zotero.Attachments storage dir + Zotero.File / IOUtils
```

原则：

- **文件 IO 与 Zotero API 在父环境 / 插件脚本**，不在不可信逻辑里散落。  
- iframe 只收 display URL 或通过协议请求解析。  
- 保持现有 `getValue` 缓存与 autosave；插图后走同一 save 路径。

### 6.1 协议扩展（建议）

| 方向 | type | 说明 |
|------|------|------|
| 父→子 | `insertAtCursor` | 插入 markdown 字符串 |
| 子→父 | `requestPasteImage` | 可选：子报告粘贴了图，父处理文件 |
| 子→父 | `resolveAsset` | `{ path, requestId }` |
| 父→子 | `assetResolved` | `{ requestId, dataUrl \| error }` |

也可父页统一拦 paste，减少子页权限问题。

---

## 7. 分阶段交付

| 阶段 | 内容 | 验收 |
|------|------|------|
| **I0** | 同步探针 + contentType/stored 校验工具函数 | 探针报告写入 docs 或 issue |
| **I1** | `MarkdownImageService`：写 assets、相对路径、读 dataURL | 单测路径拼接 / MIME |
| **I2** | 工具栏选文件插入 + 保存 md | 列表无新附件；重开可见图 |
| **I3** | 粘贴图片 | 剪贴板图进 assets + 引用 |
| **I4** | Preview + Live 渲染 | 三种模式显示一致 |
| **I5** | 缺失占位、大小限制、可选 GC | 边界行为明确 |
| **I6** | 拖拽（可选） | — |

---

## 8. 风险与对策摘要

| 风险 | 等级 | 对策 |
|------|------|------|
| 只写 assets 不触发同步 | 高 | 强制保存 md / touch / to_upload |
| contentType 非 text/* | 高 | 创建与插入前断言 |
| 整包冲突 | 中 | 提示检查图片；避免双端同编 |
| zip 体积变大 | 中 | 限大小、压缩策略后续 |
| linked md | 中 | 禁用插图或单独方案 |
| SVG XSS | 中 | Preview 消毒或默认禁 SVG |
| iframe 读本地文件 | 中 | data URL 回传 |
| 孤儿 assets | 低 | 可选 GC |

---

## 9. 成功标准

1. 粘贴/选文件插图后，库列表 **不出现** 新的图片附件条目。  
2. md 中为相对 `assets/...`（或约定 scheme），无绝对路径。  
3. 保存并同步后，第二客户端能打开 md 并看到图（I0 探针通过）。  
4. 删除 md 附件后，对应 storage 目录（含 assets）一并清理（Zotero 默认行为）。  
5. Live / Source / Preview 行为符合 §4.3。  
6. 不破坏现有 autosave、主题、Live 行级编辑。

---

## 10. 待决问题（评审时拍板）

1. 引用语法：仅相对路径，还是同时支持 `zotero-md://asset/`？  
2. SVG 是否允许？  
3. 单图大小 / 总 assets 上限默认值？  
4. 删除引用后是否自动 GC，还是仅手动？  
5. Live 模式图片是 widget 还是仅 Preview 显示图（Source 始终文本）？  

**建议默认：** 相对路径为主；SVG 第一期禁止；单图 15MB；GC 手动；Live + Preview 都显示图。

---

## 11. 文档与后续

- 实现计划：确认本规格后，编写 `docs/superpowers/plans/YYYY-MM-DD-markdown-images.md`。  
- 与 Live Preview 的交叉：图片 decoration 放在 `src/editor/live-preview/` 扩展，IO 放在 `src/modules/markdown/images/`（建议）。  

## 12. 确认记录

- 2026-08-13：方案 A 调研结论写入本规格；待用户评审后进入实现计划。
