# Markdown 图片方案（索引）

正式规格见：

**[docs/superpowers/specs/2026-08-13-markdown-images-design.md](../superpowers/specs/2026-08-13-markdown-images-design.md)**

## 一句话

图片作为 **md stored 附件 storage 目录内的 `assets/` 文件**（不是独立 attachment item，也不是用户可见的 zip 包）；同步时由 Zotero 对 `text/*` 附件做整目录打包上传。

## 关键约束

1. 仅 stored + `text/markdown`
2. 写图必须同时保存 md（触发同步）
3. 引用用 `assets/...`，禁止绝对路径
