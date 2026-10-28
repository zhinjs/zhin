import type { SelfChangeSyntaxCheck, SelfChangeTrialOptions } from '@zhin.js/agent';

/**
 * ADR 0040 §3: `.tsx` / `.jsx` drafts are loaded by the tsx loader (esbuild), so the trial checks
 * their syntax with the same transformer. In memory only; esbuild is loaded on first use.
 */
export function createSelfChangeTrialOptions(): SelfChangeTrialOptions {
  return Object.freeze({ jsxSyntax: esbuildJsxSyntax });
}

let esbuild: Promise<typeof import('esbuild')> | undefined;

export const esbuildJsxSyntax: SelfChangeSyntaxCheck = async (target, source) => {
  esbuild ??= import('esbuild');
  const { transform } = await esbuild;
  try {
    await transform(source, {
      loader: /\.jsx$/iu.test(target) ? 'jsx' : 'tsx',
      jsx: 'automatic',
      jsxImportSource: 'zhin.js',
      format: 'esm',
      sourcefile: target,
      logLevel: 'silent',
    });
    return null;
  } catch (error) {
    const errors = (error as { errors?: { text?: string; location?: { line?: number; column?: number } | null }[] }).errors;
    const first = errors?.[0];
    if (first?.text) {
      const at = first.location ? ` (${first.location.line}:${first.location.column})` : '';
      return `${first.text}${at}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
};
