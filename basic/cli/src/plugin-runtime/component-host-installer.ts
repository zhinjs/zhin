import { compiler } from '@zhin.js/core';
import { componentHostToken, type ComponentHost, type TemplateContext } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

function createComponentHost(): ComponentHost {
  return {
    compileTemplate(text: string, context: TemplateContext): string {
      return compiler(text, { ...context });
    },
  };
}

export function installComponentHost(): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(componentHostToken, createComponentHost());
  };
}
