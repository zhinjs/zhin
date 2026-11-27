/**
 * `@zhin.js/console-ui/audit` — the Playwright layout audit of ADR 0063 D20 (Node side).
 *
 *   auditPage(page, options)         audit the page a Playwright `Page` shows now
 *   runLayoutAudit(page, options)    the same over 375 / 768 / 1280 / 1920 × light / dark
 *   auditPluginPages(request)        mount plugin pages and audit them (used by `pnpm check:plugin-ui-audit`)
 *   formatAuditReport(report)        text summary
 *
 * Check ids: AUDIT_CHECKS (plus `mount` from auditPluginPages); consistency groups and ring placement:
 * AUDIT_VARIANT_SLOTS, AUDIT_RING_SLOTS. Exemptions:
 * `data-zhin-ui-ignore="<check>[,<check>…]: <reason>"` on an element covers it and its subtree.
 */
export {
  AUDIT_CHECKS,
  AUDIT_RING_SLOTS,
  AUDIT_THEMES,
  AUDIT_VARIANT_SLOTS,
  AUDIT_WIDTHS,
  auditPage,
  formatAuditReport,
  runLayoutAudit,
  setConsoleTheme,
} from './layout-audit.mjs';
export { auditPluginPages } from './plugin-pages.mjs';
