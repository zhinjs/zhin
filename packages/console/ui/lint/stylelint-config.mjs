/**
 * Shared stylelint config of ADR 0063 D20 (`@zhin.js/console-ui/stylelint`), for
 * @zhin.js/console-ui itself and for zhinjs/console:
 *
 *   // stylelint.config.mjs
 *   import { createConsoleStylelintConfig } from '@zhin.js/console-ui/stylelint';
 *   export default createConsoleStylelintConfig({
 *     shellFiles: ['console-ui/src/shell\\.css$', 'console-ui/src/layouts/'],  // may use @media
 *   });
 *
 * Options:
 *   shellFiles         regex sources of files allowed to use @media (global shell only)
 *   semanticOnly       components read tier-2 tokens only (default true)
 *   allowTierOneIn     regex sources of files that may read tier-1 spacing / radius / elevation
 *   deprecatedTokens   severity of `console/no-deprecated-tokens` ('error' default; 'warning'
 *                      while a codebase moves off the old names, until P4)
 */
import plugins from './stylelint-plugin.mjs';

export function createConsoleStylelintConfig({
  shellFiles = [],
  semanticOnly = true,
  allowTierOneIn = [],
  deprecatedTokens = 'error',
  ignoreFiles = [],
} = {}) {
  return {
    plugins,
    ignoreFiles: ['**/node_modules/**', '**/dist/**', ...ignoreFiles],
    rules: {
      'console/scale-values': [true, { semanticOnly, allowTierOneIn }],
      'console/no-unknown-tokens': true,
      'console/no-deprecated-tokens': [true, { severity: deprecatedTokens }],
      'console/media-queries': [true, { shellFiles }],
    },
  };
}

export default createConsoleStylelintConfig();
