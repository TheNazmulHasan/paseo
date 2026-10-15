export {
  classifyAssistantFileLink,
  normalizeInlinePathTarget,
  type InlinePathTarget,
} from "./parse";
export {
  AssistantFileLinkResolverProvider,
  useAssistantFileLinkEnvironment,
  useAssistantFileLinkEnvironmentBridge,
  type AssistantFileLinkResolverProviderProps,
} from "./provider";
export type { AssistantFileLinkSource } from "./resolver";
export { useAssistantFileLinkActions, useFileLink } from "./use-file-link";
export { classifyCodeQuickAction, getRevealParentPath } from "./quick-action";
export { useRevealInFileManager } from "./use-reveal-in-file-manager";
export { AssistantLinkInlineActions, useAssistantLinkActions } from "./link-actions";

export { createInlinePathOpener } from "./path-open";
