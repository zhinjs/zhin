/**
 * @zhin.js/console-ui — the one component library of the Zhin Console and plugin pages (ADR 0063).
 * Styles ship precompiled: import `@zhin.js/console-ui/styles.css` (tokens + components) once, or
 * `@zhin.js/console-ui/tokens.css` for the tokens alone.
 */
export { cn, type ClassValue } from './cn.js';
export { CONSOLE_UI_VERSION } from './version.js';
export {
  CONSOLE_UI_MODULE_ID,
  CONSOLE_SHARED_MODULE_VERSIONS_KEY,
  CONSOLE_SHARED_MODULE_ISSUE_EVENT,
  CONSOLE_SHARED_MODULE_ISSUES_KEY,
  registerConsoleUiSharedModule,
  type ConsoleSharedModuleIssue,
} from './shared-module.js';
export * from './i18n/index.js';

export * from './components/ui/accordion.js';
export * from './components/ui/alert.js';
export * from './components/ui/badge.js';
export * from './components/ui/button.js';
export * from './components/ui/card.js';
export * from './components/ui/checkbox.js';
export * from './components/ui/dialog.js';
export * from './components/ui/dropdown-menu.js';
export * from './components/ui/input.js';
export * from './components/ui/list-item-button.js';
export * from './components/ui/popover.js';
export * from './components/ui/radio-group.js';
export * from './components/ui/scroll-area.js';
export * from './components/ui/searchable-select.js';
export {
  groupSelectOptions,
  navigableValues,
  optionMatches,
  optionSearchText,
  type SearchableSelectGroup,
} from './components/ui/searchable-select-model.js';
export * from './components/ui/select.js';
export * from './components/ui/separator.js';
export * from './components/ui/sheet.js';
export * from './components/ui/skeleton.js';
export * from './components/ui/switch.js';
export * from './components/ui/table.js';
export * from './components/ui/tabs.js';
export * from './components/ui/textarea.js';
export * from './components/ui/tooltip.js';

export * from './components/PageShell.js';
export * from './components/PageHeader.js';
export * from './components/confirm-dialog.js';
export { canSubmitConfirm, confirmErrorMessage, confirmTextMatches } from './components/confirm-dialog-model.js';
export * from './components/StatCard.js';
export * from './components/empty-state.js';
export * from './components/error-alert.js';
export * from './components/InfoHint.js';
export * from './components/RefreshControl.js';
export {
  DEFAULT_REFRESH_INTERVALS,
  formatRefreshTime,
  refreshIntervalOptions,
} from './components/refresh-control-model.js';
export * from './components/page-chrome.js';
export * from './components/actions.js';
export * from './components/layout.js';
export * from './components/StatusBadge.js';
export { useContainerAtLeast, CONSOLE_BREAKPOINTS_REM } from './components/use-container-width.js';
export * from './components/content-blocks.js';
