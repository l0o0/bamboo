<p align="center">
  <img src="../docs/icons/scholar-sketch-logo.png" alt="Scholar Sketch — Read · Organize · Think" width="640" />
</p>

<h1 align="center">Scholar Sketch</h1>

<p align="center"><strong>Markdown &amp; Whiteboard for Zotero</strong></p>

<p align="center">Zotero 中的 Markdown 编辑器与可视化白板</p>

<p align="center">
  <a href="https://www.zotero.org"><img src="https://img.shields.io/badge/Zotero-9%2F10%2F11-green?style=flat-square&amp;logo=zotero&amp;logoColor=CC2936" alt="Zotero compatibility" /></a>
  <a href="https://github.com/l0o0/scholar-sketch/releases"><img src="https://img.shields.io/badge/version-0.2.6-blue?style=flat-square" alt="version" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square" alt="license" /></a>
</p>

Scholar Sketch 为 Zotero 扩展 Markdown 笔记与可视化白板，让文献、PDF 注释和想法在同一工作空间中连接起来。

[English](../README.md) | [简体中文](README-zhCN.md) · [下载安装](https://github.com/l0o0/scholar-sketch/releases/latest)

## 功能

- **Markdown 编辑**：Live 即时预览、源码编辑与阅读预览，支持表格、图片、公式和脚注。
- **双链笔记**：`[[笔记]]` 链接、目录、反向链接侧栏与文库全文搜索。
- **研究白板**：组织文献、注释、笔记和附件，通过分组与连线梳理想法，支持批量样式和自动布局。
- **Zotero 联动**：将文献拖入白板，浏览 PDF 注释，或从文字批注生成 Markdown 笔记。
- **便携文件**：使用 `.md` 与 JSON Canvas `.canvas` 格式；笔记可连同图片导出到 Obsidian 等工具，白板可导出 PNG、SVG 或 Markdown。
- **保存与恢复**：自动保存、本地历史与文件冲突检查，支持标签页和独立窗口。

## 安装

支持 **Zotero 9 / 10 / 11 桌面版**。

1. 从 [Releases](https://github.com/l0o0/scholar-sketch/releases/latest) 下载 `scholarsketch-v{version}.xpi`。
2. 在 Zotero 中打开 **工具 → 插件 → 齿轮 → 从文件安装插件…**，选择下载的文件。

## 界面预览

**研究白板：连接文献、注释与想法。**

![Scholar Sketch 研究白板：文献、注释、问题、观点与总结卡片](../docs/screenshots/research-whiteboard.jpg)

**Markdown：实时编辑与双链引用。**

![Scholar Sketch Markdown 编辑器：表格、双链笔记、目录与引用侧栏](../docs/screenshots/markdown-linked-notes.jpg)

<details>
<summary>批量调整卡片和连线样式</summary>

![Scholar Sketch 多选样式菜单](../docs/screenshots/canvas-batch-styles.jpg)

</details>

## 快速开始

- **写笔记**：点击工具栏的 **Scholar Sketch** 按钮 → **新建 Markdown 笔记…**。先选中文献可创建其附属笔记；取消选择则在当前文库或分类下创建独立笔记。之后双击 `.md` 附件即可继续编辑，输入 `[[` 可链接其他笔记。
- **建白板**：点击工具栏的 **Scholar Sketch** 按钮 → **新建白板…**，拖入文献、添加卡片并连接想法。按住 **空格** 拖动可移动画布。
- **试用示例**：选择 **帮助 → Scholar Sketch：创建示例白板**。

存储附件可随 Zotero 文件同步；链接附件需自行同步。本地历史仅保存在当前设备。

## 文档

- [双链与导出](../docs/obsidian-links.md)
- [保存与历史恢复](../docs/file-safety.md)
- [功能使用说明](../docs/markdown-canvas-release-features.md)

<details>
<summary>开发与插件集成</summary>

```bash
pnpm install
cp .env.example .env  # 配置 Zotero 开发环境
pnpm start           # 构建并启动 Zotero
pnpm run build       # 生成 XPI
```

[浏览器测试](../docs/fake-zotero.md) · [Markdown API](../docs/markdown-api.md) · [Canvas API](../docs/canvas-api.md)

</details>

欢迎通过 [Issues](https://github.com/l0o0/scholar-sketch/issues) 反馈问题或提交 PR。

基于 [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) 与 [markdown-it](https://github.com/markdown-it/markdown-it) 构建。

[AGPL-3.0-or-later](../LICENSE)
