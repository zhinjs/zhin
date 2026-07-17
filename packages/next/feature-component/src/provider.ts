import { featureId } from '@zhin.js/next-kernel';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/next-feature-kit';
import { ComponentIndex } from './component-index.js';
import { parseComponentDefinition } from './definition.js';

export const componentFeatureId = featureId('zhin.component');

const componentFeature = defineFeatureProvider({
  protocol: 1,
  id: componentFeatureId,
  authoring: {
    conventions: [typeScriptModules({
      id: 'components-tsx',
      directory: 'components',
      tsx: true,
    })],
    validate: parseComponentDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new ComponentIndex(slots, context.snapshot) };
    },
  },
});

export { componentFeature };
export default componentFeature;
