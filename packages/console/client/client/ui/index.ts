/** `@zhin.js/client/ui` — 插件页 UI 套件：与 Console 同一套主题变量，不依赖 Tailwind。 */
export { pluginUiStyles } from './styles.js';
export {
  PluginPage, Button, Badge, Notice, EmptyState, LoadingState, ErrorState, StaleNotice, ConfirmButton, Field, PageHeader, Section,
  type ButtonProps, type ButtonVariant, type ButtonSize, type BadgeTone, type NoticeProps, type NoticeTone, type ConfirmButtonProps, type FieldControlProps,
} from './components.js';
export {
  usePluginRpc, useRpcResource,
  type RpcResource, type RpcResourceState, type RpcResourceOptions, type UsePluginRpcOptions,
} from './rpc.js';
export { useLocale, detectLocale, translate, formatClock, type PluginUiLocale, type PluginUiText } from './locale.js';
export { resolvePluginId, type ResolvePluginIdOptions } from './plugin-id.js';
