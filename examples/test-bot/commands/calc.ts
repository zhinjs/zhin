import { defineCommand } from '@zhin.js/command';
import { formatArithmeticResult } from '../lib/safe-expr.js';

/** Safe arithmetic (`+ - * / %` + parentheses). No eval. */
export default defineCommand({
  description: '计算算术表达式（安全解析，非 eval）',
  execute: ({ args }) => {
    const expression = args.join(' ').trim();
    if (!expression) return '用法: calc 2 + 3 * (4 - 1)';
    return formatArithmeticResult(expression);
  },
});
