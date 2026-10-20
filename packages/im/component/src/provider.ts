import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { ComponentIndex } from './component-index.js';
import { parseComponentDefinition } from './definition.js';

export const componentFeatureId = featureId('zhin.component');

const componentFeature = defineFeatureProvider({
  protocol: 1,
  id: componentFeatureId,
  authoring: {
    setupMethod: 'addComponent',
    conventions: [directoryModules({
      id: 'components-index',
      extensions: ['ts', 'tsx', 'js', 'mjs', 'cjs'],
      layouts: [{ segments: ['components', capture('name')], localName: (values) => captured(values, 'name') }],
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
