export type MoreMenuAction =
  | "document-info"
  | "rename"
  | "show-in-folder"
  | "find"
  | "source"
  | "mode"
  | "export-pdf"
  | "export-html"
  | "shortcuts"
  | "settings"
  | "import-external-images"
  | "cleanup-images";

export interface MoreMenuItem {
  action: MoreMenuAction;
  label: string;
  shortcut?: string;
  submenu?: boolean;
}

export const EDITOR_MODE_OPTIONS = [
  { mode: "live", label: "Live" },
  { mode: "source", label: "源码" },
  { mode: "preview", label: "只读预览" },
] as const;

export const MORE_MENU_SECTIONS: readonly (readonly MoreMenuItem[])[] = [
  [
    { action: "document-info", label: "文档信息" },
    { action: "rename", label: "重命名" },
    { action: "show-in-folder", label: "在文件夹中显示" },
  ],
  [
    { action: "find", label: "查找与替换", shortcut: "⌘F" },
    { action: "source", label: "Markdown 源码", shortcut: "↗" },
    { action: "mode", label: "模式", submenu: true },
  ],
  [
    { action: "export-pdf", label: "导出为 PDF" },
    { action: "export-html", label: "导出为 HTML" },
  ],
  [
    { action: "import-external-images", label: "导入外链图片" },
    { action: "cleanup-images", label: "清理未引用图片" },
    { action: "shortcuts", label: "快捷键" },
    { action: "settings", label: "设置", submenu: true },
  ],
];
