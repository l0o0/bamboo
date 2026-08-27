export { isMarkdownAttachment } from "./detect";
export { createMarkdownAttachment, createMarkdownForSelection } from "./create";
export {
  openMarkdownAttachment,
  registerFileOpenInterceptor,
  unregisterFileOpenInterceptor,
} from "./open";
export {
  openMarkdownTab,
  closeMarkdownTab,
  flushAllSessions,
  flushSessionsForWindow,
} from "./tab";
export { openMarkdownWindow, closeAllMarkdownWindows } from "./window";
export {
  registerMenus,
  registerItemContextMenu,
  unregisterItemContextMenu,
  unregisterMenus,
  registerShortcuts,
  unregisterShortcuts,
} from "./menu";
export { injectMarkdownStyles } from "./styles";
export { registerMarkdownTabHooks, MARKDOWN_TAB_TYPE } from "./tabHooks";
export {
  buildNoteWithFrontmatter,
  frontmatterFromItem,
  parseFrontmatter,
  stripFrontmatter,
} from "./frontmatter";
export {
  markdownApi,
  MarkdownApiError,
  applyFrontmatterPatch,
  type MarkdownApi,
  type MarkdownAttachmentInfo,
  type ListOptions,
  type CreateOptions,
  type CreateLinkedOptions,
  type FrontmatterPatch,
  type UpdateOptions,
  type WriteResult,
  type SessionSummary,
  type MarkdownApiErrorCode,
} from "./api";
export {
  registerSidebarSection,
  unregisterSidebarSection,
  disposeSidebarForWindow,
} from "./sidebar";
