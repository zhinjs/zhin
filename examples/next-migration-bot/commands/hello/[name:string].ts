import { defineLegacyCommand } from '@zhin.js/next-compat';

export default defineLegacyCommand({
  action: (_message, result) => `hello ${result.params.name}`,
});
