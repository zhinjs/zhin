import { describe, expect, it } from 'vitest';
import { createSelfChangeTrialOptions, esbuildJsxSyntax } from '../../../src/plugin-runtime/agent/self-change-trial.js';

describe('self-change trial options', () => {
  it('checks .tsx drafts with esbuild like the tsx loader', async () => {
    expect(createSelfChangeTrialOptions().jsxSyntax).toBe(esbuildJsxSyntax);
    const ok = "import { defineComponent } from 'zhin.js/component';\nexport default defineComponent(() => <text>hi</text>);\n";
    expect(await esbuildJsxSyntax('components/hi.tsx', ok)).toBeNull();
    expect(await esbuildJsxSyntax('components/hi.tsx', 'export default () => <text>hi</div>;\n')).toMatch(/\(1:\d+\)$/u);
  });
});
