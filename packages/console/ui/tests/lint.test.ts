import { Linter } from 'eslint';
import stylelint from 'stylelint';
import tseslint from 'typescript-eslint';
// @ts-expect-error — plain ESM modules without declarations
import consoleUi from '../lint/eslint-plugin.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { classifyClass } from '../lint/tailwind-classes.mjs';
// @ts-expect-error — plain ESM modules without declarations
import { createConsoleStylelintConfig } from '../lint/stylelint-config.mjs';

describe('Tailwind class classifier (D17, D20)', () => {
  it.each([
    ['p-7', 'off-scale'], ['gap-2.5', 'off-scale'], ['md:px-3.5', 'off-scale'], ['-mx-7', 'off-scale'], ['p-9', 'off-scale'],
    ['shadow-md', 'off-scale'], ['shadow', 'off-scale'], ['rounded-md', 'off-scale'], ['rounded', 'off-scale'], ['rounded-8', 'off-scale'],
    ['text-base', 'off-scale'], ['text-3xl', 'off-scale'], ['font-bold', 'off-scale'], ['border-2', 'off-scale'], ['h-13', 'off-scale'],
    ['p-[5px]', 'arbitrary'], ['rounded-[var(--console-radius-md)]', 'arbitrary'], ['text-[13px]', 'arbitrary'],
    ['text-[length:var(--console-text-body)]', 'arbitrary'], ['shadow-[0_1px_2px_black]', 'arbitrary'], ['[padding:3px]', 'arbitrary'],
  ])('%s → %s', (token, rule) => {
    expect(classifyClass(token)?.rule).toBe(rule);
  });

  it.each(['p-4', 'p-5', 'gap-10', 'px-3', 'gap-2', 'space-y-6', 'mx-auto', 'p-px', 'h-11', 'size-control', 'size-tile', 'h-control-medium', 'w-[calc(100%-2rem)]', 'rounded-control', 'rounded-full',
    'rounded-pill', 'rounded-7', 'rounded-hero', 'shadow-hairline', 'shadow-float', 'text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'text-title', 'text-display',
    'bg-tint-2', 'text-accent-2', 'bg-sunken', 'text-ink',
    'shadow-e2', 'shadow-popover', 'text-body', 'text-muted-foreground', 'text-[hsl(var(--primary))]', 'font-strong', 'border', 'border-0',
    'bg-primary/72', 'data-[state=open]:bg-accent', 'rounded-[inherit]', 'hover:border-[hsl(var(--primary))]'])('%s is fine', (token) => {
    expect(classifyClass(token)).toBeNull();
  });
});

describe('ESLint plugin', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = [
    { files: ['**/*.tsx'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
    { files: ['**/*.tsx'], ...consoleUi.configs.recommended },
  ];
  const lint = (code: string) => linter.verify(code, config, 'page.tsx').map((message) => message.ruleId);

  it('reports arbitrary values, off-scale classes and native controls', () => {
    expect(lint('const a = <div className="p-[5px] gap-2.5" />')).toEqual(['console-ui/no-arbitrary-values', 'console-ui/no-off-scale-classes']);
    expect(lint('const a = <div className="p-5 gap-10 text-sm rounded-pill" />')).toEqual([]);
    expect(lint('const a = cn("shadow-md", cond && "p-4")')).toEqual(['console-ui/no-off-scale-classes']);
    expect(lint('const a = cva("rounded-lg", { variants: { size: { "p-7": "px-3" } } })')).toEqual(['console-ui/no-off-scale-classes']);
    expect(lint('const a = <><button /><select /><table /></>')).toEqual(Array(3).fill('console-ui/no-native-controls'));
  });

  it('ignores strings that are not classes', () => {
    expect(lint('const a = <div title="p-7" onClick={() => log("text-base")} className="p-4 text-body" />')).toEqual([]);
  });
});

describe('stylelint config', () => {
  const lint = async (code: string, file = '/x/components.css', options = {}) => {
    const { results } = await stylelint.lint({ code, codeFilename: file, config: createConsoleStylelintConfig({ shellFiles: ['shell\\.css$'], ...options }) });
    return results[0].warnings.map((warning) => warning.rule);
  };

  it('allows tokens, 0 and keywords', async () => {
    expect(await lint('.a { padding: var(--console-card-padding) 0; margin: 0 auto; gap: var(--console-stack-gap); border: var(--console-card-border) solid hsl(var(--border)); box-shadow: none; font-weight: var(--console-weight-strong); margin-inline: calc(-1 * var(--console-page-padding-inline)); }')).toEqual([]);
  });

  it('reports literals, tier-1 tokens in components, unknown and removed tokens', async () => {
    expect(await lint('.a { padding: 5px; font-weight: 700; box-shadow: 0 1px 2px hsl(0 0% 0% / .1); border-radius: 0.5rem; }'))
      .toEqual(['console/scale-values', 'console/scale-values', 'console/scale-values', 'console/scale-values']);
    expect(await lint('.a { padding: var(--console-space-3); }')).toEqual(['console/scale-values']);
    expect(await lint('.a { padding: var(--console-space-4-5); border-radius: var(--console-radius-7); }')).toEqual(['console/scale-values', 'console/scale-values']);
    expect(await lint('.a { padding: var(--console-card-padding); border-radius: var(--console-pill-radius); box-shadow: var(--console-hairline-ring); color: hsl(var(--console-ink)); background: hsl(var(--console-tint-2)); }')).toEqual([]);
    expect(await lint('.a { padding: var(--console-space-3); }', '/x/tokens.css', { allowTierOneIn: ['tokens\\.css$'] })).toEqual([]);
    expect(await lint('.a { color: var(--console-nope); }')).toEqual(['console/no-unknown-tokens']);
    expect(await lint('.a { border-radius: var(--console-radius-md); }')).toEqual(['console/no-deprecated-tokens']);
    expect(await lint('.a { box-shadow: var(--console-shadow-ring); }')).toEqual(['console/no-deprecated-tokens']);
  });

  it('motion: no millisecond / second literals and no easing literals (zhinjs/console#125)', async () => {
    expect(await lint('.a { transition: color var(--console-motion-fast) var(--console-ease-out), opacity var(--console-motion-base) var(--console-ease-out); animation: spin calc(var(--console-motion-slow) * 5) linear infinite; transition-delay: 0s; }')).toEqual([]);
    expect(await lint('.a { transition: color 150ms ease; }')).toEqual(['console/motion-tokens', 'console/motion-tokens']);
    expect(await lint('.a { animation: x 0.2s cubic-bezier(0.2, 1, 0.3, 1); }')).toEqual(['console/motion-tokens', 'console/motion-tokens']);
    expect(await lint('.a { transition-duration: 200ms; animation-delay: 1s; }')).toEqual(['console/motion-tokens', 'console/motion-tokens']);
    expect(await lint('@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }', '/x/shell.css')).toEqual([]);
    expect(await lint('.a { transition: color 150ms; }', '/x/components.css', { motionTokens: 'warning' })).toEqual(['console/motion-tokens']);
    expect(await lint('.a { transition: color 150ms; }', '/x/components.css', { motionTokens: false })).toEqual([]);
  });

  it('keeps @media in shell files and on the breakpoints', async () => {
    expect(await lint('@media (min-width: 40rem) { .a { color: red; } }')).toEqual(['console/media-queries']);
    expect(await lint('@media (min-width: 40rem) { .a { color: red; } }', '/x/shell.css')).toEqual([]);
    expect(await lint('@media (--console-lg) { .a { color: red; } }', '/x/shell.css')).toEqual([]);
    expect(await lint('@media (min-width: 700px) { .a { color: red; } }', '/x/shell.css')).toEqual(['console/media-queries']);
    expect(await lint('@container console (width < 40rem) { .a { color: red; } }')).toEqual([]);
    expect(await lint('@container (min-width: 33rem) { .a { color: red; } }')).toEqual(['console/media-queries']);
  });
});
