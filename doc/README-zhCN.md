# Zotero Markdown

[![zotero target version](https://img.shields.io/badge/Zotero-7%2F8-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/l0o0/zotero-markdown)
[![license](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](../LICENSE)

**让 Zotero 原生支持 Markdown。** 把 `.md` 文件当作一等公民附件——在 Zotero 内打开、编辑、预览、创建。

[English](../README.md) | [简体中文](README-zhCN.md)

---

## 为什么做这个

Zotero 擅长文献收集与组织。在 AI 时代，**纯 Markdown 文件**才是知识工具之间的通用货币（Obsidian、大模型、静态站点、Git）。

[Better Notes](https://github.com/windingwind/zotero-better-notes) 大幅增强了 Zotero 自带的 **Note**，但那仍然是 Zotero 笔记，不是磁盘上的原生 `.md` 文件。

**Zotero Markdown** 补上这块短板：

| | Better Notes | **Zotero Markdown** |
|--|--|--|
| 主战场 | Zotero Note（富文本笔记） | 真正的 **`.md` 附件文件** |
| 磁盘文件 | 可选同步 / 导出 | 文件本身就是笔记 |
| Obsidian / AI | 桥接 / 导出 | 直接可用的纯文本 |
| 关系 | — | **互补**——我们不碰 Note |

> Make Zotero Great Again — 让知识管理在 Zotero 里重新长出 Markdown 这一支。

---

## 功能（v0.1）

- **打开** `.md` / `.markdown` 附件：在主窗口 **Tab** 中打开（不再调系统默认应用）
- **编辑**：[CodeMirror 6](https://codemirror.net/)（高亮、换行、撤销、搜索）
- **预览**：一键切换 Edit / Preview
- **保存**：防抖自动保存 + **Ctrl/Cmd+S**
- **新建 Markdown…**：条目右键菜单（默认 Stored 附件）
- 同时支持 **Stored** 与 **Linked** 附件
- 偏好设置中可关闭打开拦截

### 规划中（不在 v0.1）

- Wiki 链接 `[[...]]` 与库内跳转
- YAML frontmatter ↔ Zotero 字段
- PDF 高亮 / 注释导出为 `.md`
- Linked 文件被外部修改时自动 reload
- Markdown Tab 的会话恢复

---

## 安装

### 使用 XPI（发布版）

1. 从 [Releases](https://github.com/l0o0/zotero-markdown/releases) 下载最新 `.xpi`
2. Zotero：**工具 → 插件 → 齿轮 → 从文件安装插件…**
3. 如有提示，重启 Zotero

### 本地构建

```bash
pnpm install
pnpm run build
# 产物：.scaffold/build/zotero-markdown.xpi
```

---

## 使用

1. 选中文献 → 右键 → **新建 Markdown…**  
   会创建 Stored 的 `.md` 附件并打开。
2. 在 Tab 中编辑。输入会自动保存；**Ctrl/Cmd+S** 立即保存。
3. 点 **Preview** 预览，点 **Edit** 回到源码。
4. 之后双击任意 `.md` 附件即可再次打开。
5. 或在 `.md` 附件上右键 → **用 Markdown 编辑器打开**。

也可以把已有 `.md` 拖进 Zotero（或添加链接附件），双击同样由本插件打开。

---

## 环境要求

- Zotero **7** 或 **8**（含 beta）
- 桌面客户端（不支持 Zotero 网页版）

---

## 开发

基于 [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) 与 [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)。包管理器使用 **pnpm**。

### 环境准备

```bash
# 配置 Zotero 可执行文件 / 开发 profile / 数据目录
cp .env.example .env

pnpm install
pnpm start          # 构建并启动 Zotero，支持热重载
```

国内用户：项目 `.npmrc` 已配置 [npmmirror](https://npmmirror.com/) 镜像。

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm start` | 开发模式 + 热重载 |
| `pnpm run build` | 生产构建 + 类型检查 |
| `pnpm test` | 插件测试 |
| `pnpm run lint:check` | Prettier + ESLint |
| `pnpm run lint:fix` | 自动修复 |

### 目录结构

```
src/
  hooks.ts                 # 生命周期
  modules/markdown/
    detect.ts              # 识别 markdown 附件
    create.ts              # 新建 stored .md
    open.ts                # 拦截 FileHandlers
    tab.ts                 # Tab UI、自动保存
    editor.ts              # CodeMirror 6
    preview.ts             # markdown-it 渲染
    menu.ts                # 右键菜单
    styles.ts              # 样式注入
addon/                     # bootstrap、语言包、偏好、图标
```

### `.env`（仅开发）

见 [`.env.example`](../.env.example)，主要变量：

- `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` — Zotero 可执行文件
- `ZOTERO_PLUGIN_PROFILE_PATH` — 开发用 profile
- `ZOTERO_PLUGIN_DATA_DIR` — 可选数据目录

---

## 设置

**编辑 → 设置 → Zotero Markdown**

- **使用 Markdown 编辑器打开 .md 附件** — 关闭后，`.md` 恢复为系统默认程序打开

---

## 常见问题

**会取代 Better Notes 吗？**  
不会。Better Notes 增强 Zotero Note；本插件只处理真正的 **Markdown 文件**附件。可以同时安装。

**文件存在哪里？**  
- **新建 Markdown…** 创建的是 Zotero storage 下的 **Stored** 附件。  
- 也可以添加 **Linked** 附件，指向 Obsidian vault 或任意文件夹。

**会随 Zotero 同步吗？**  
Stored 附件遵循 Zotero 文件同步（若已开启）。Linked 文件不会随 Zotero 文件同步上传。

**识别哪些扩展名？**  
`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`，以及 `text/markdown` 类型。

---

## 贡献

欢迎 Issue 与 PR。较大功能请先开 Issue 对齐范围。

---

## 致谢

- 基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [CodeMirror](https://codemirror.net/)、[markdown-it](https://github.com/markdown-it/markdown-it)
- 灵感来自 Obsidian 工作流与 Zotero 社区

---

## 许可证

[AGPL-3.0-or-later](../LICENSE)
