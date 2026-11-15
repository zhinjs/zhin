/** stylelint for @zhin.js/console-ui's own styles (ADR 0063 D20): `pnpm --filter @zhin.js/console-ui lint:css`. */
import { createConsoleStylelintConfig } from './lint/stylelint-config.mjs';

export default createConsoleStylelintConfig({
  // The only hand-written file with @media: viewport-level overlays and reduced motion.
  shellFiles: ['client/styles/shell\\.css$'],
  // Generated from tokens/tokens.mjs; checked by `node tokens/generate.mjs --check`.
  ignoreFiles: ['client/styles/generated/**'],
});
