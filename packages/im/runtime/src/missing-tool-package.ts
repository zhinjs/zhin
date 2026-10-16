const TOOL_PACKAGE = '@zhin.js/tool';
const TOOL_ROOT_SPECIFIER = /['"]@zhin\.js\/tool['"]/u;

export const TOOL_PACKAGE_INSTALL_HINT = `缺少依赖 ${TOOL_PACKAGE}（tools/ 下的 defineAgentTool 需要它）。请运行: pnpm add ${TOOL_PACKAGE}`;

/** True only for ERR_MODULE_NOT_FOUND naming the `@zhin.js/tool` package root. */
export function isToolPackageMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'ERR_MODULE_NOT_FOUND'
    && typeof message === 'string'
    && TOOL_ROOT_SPECIFIER.test(message);
}

/** Return an error that carries the exact install command when `@zhin.js/tool` is missing. */
export function withToolPackageInstallHint(error: unknown): unknown {
  if (!isToolPackageMissing(error)) return error;
  const original = error as Error & { code?: string };
  const augmented = new Error(`${TOOL_PACKAGE_INSTALL_HINT}\n原始错误: ${original.message}`, { cause: error });
  (augmented as Error & { code?: string }).code = original.code;
  return augmented;
}
