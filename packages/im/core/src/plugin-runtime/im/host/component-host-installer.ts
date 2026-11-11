import { renderTemplatePaths } from '@zhin.js/kernel';
import {
  componentHostToken,
  type ComponentHost,
  type RootResourceInstaller,
  type TemplateContext,
} from '@zhin.js/plugin-runtime';

function createComponentHost(): ComponentHost {
  return {
    compileTemplate(text: string, context: TemplateContext): string {
      return renderTemplatePaths(text, { ...context });
    },
  };
}

export function installComponentHost(): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(componentHostToken, createComponentHost());
  };
}
