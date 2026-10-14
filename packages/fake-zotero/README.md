# @zotero-plugin/fake-zotero

浏览器调试用的最小 Zotero fake。它不启动 Gecko，也不访问数据库或
`localStorage`：

```js
import { createFakeZotero } from "@zotero-plugin/fake-zotero";

const fake = createFakeZotero({
  prefs: { "extensions.zotero.demo.enabled": true },
  items: [{ id: 1, key: "ABC", itemType: "journalArticle" }],
});
const restore = fake.install(globalThis);
// 调试结束后：restore();
```

支持 `Prefs`、用户和库、按 ID/库+key 检索 items、父子关系、note 和
annotation 属性、`saveTx` 的内存变更、选中/打开操作，以及已完成的
ready Promises。还提供简单的 `Utilities.cleanTags/unescapeHTML`。
`snapshot()` 返回可序列化快照，`reset()` 恢复初始数据并
清空 `calls`。

这是调试 fixture，仅提供下述 Search 元数据子集，不提供 DB、IOUtils、XUL、真实事务或持久化。
插件需要的 HTML 工具函数应由浏览器测试环境提供。

## API 边界

- `Prefs.get/set/clear(key, …, global?)` 默认给 key 加上 `extensions.zotero.`；`global: true` 使用原始 key。种子 `prefs` 一律使用完整存储 key。插件前缀（例如 `demo.`）由消费者提供。
- `Items.get/getAsync` 支持单个 ID 或 ID 数组；`getByLibraryAndKey` 按库区分同名 key。未找到的单条结果是 `false`。
- `Items.getAll(libraryID?)` 仅支持库参数；传入 Zotero 的其他筛选参数会抛错，避免误以为筛选已生效。
- `new Search({ libraryID })` 支持 `title is/contains` 和 `itemType is` 条件，以 AND 组合；标题匹配忽略大小写。与宿主一致，`title` 字段索引不含原生笔记，需通过 `itemType is note` 列出后读取标题。其他条件会抛错，避免假成功。
- 父条目必须先存在于同一个 fixture 中且属于同库。可用 `getAttachments/getNotes/getAnnotations` 遍历关系。
- `setField/setNote` 和 `saveTx` 仅修改当前实例的内存；`saveTx` 不模拟数据库事务。
- `snapshot()` 是独立数据副本；`reset()` 重建条目对象，重置后需重新用 `Items.get` 获取引用。
- `calls` 记录打开、选中、保存和日志等动作，不是每个只读 API 的调用跟踪。
- `install(target?)` 默认安装到 `globalThis`，拒绝覆盖现有 `Zotero`。返回的清理函数只移除本实例安装的对象，不会删除后来替换的宿主。

不支持的宿主 API 不会自动返回成功。文件、上述子集之外的搜索、插件私有 API 和持久化应在消费者的测试入口显式适配；不要在生产入口安装 fake。完整 Gecko、XUL 和真实文件/PDF 操作仍需在 Zotero 中验证。

## 在其他项目中使用

当前包未发布。先构建并打包，再手动将 tarball 安装为目标项目的开发依赖：

```sh
pnpm --filter @zotero-plugin/fake-zotero build
cd packages/fake-zotero
npm pack
# 在目标项目目录：
pnpm add -D /absolute/path/to/zotero-plugin-fake-zotero-0.0.0.tgz
```

包只携带构建结果、类型、README 和许可证，没有运行时依赖。示例仓库提供生产白板和 Markdown 编辑器的浏览器测试入口；业务适配留在示例中。
