import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { parseMiddlewareDefinition } from './definition.js';
import { MiddlewareIndex } from './middleware-index.js';

export const middlewareFeatureId = featureId('zhin.middleware');

const middlewareFeature = defineFeatureProvider({
  protocol: 1,
  id: middlewareFeatureId,
  authoring: {
    setupMethod: 'addMiddleware',
    conventions: [directoryModules({
      id: 'middlewares-index',
      layouts: [{ segments: ['middlewares', capture('name')], localName: (values) => captured(values, 'name') }],
    })],
    validate: parseMiddlewareDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new MiddlewareIndex(slots, context.snapshot) };
    },
  },
});

export { middlewareFeature };
export default middlewareFeature;
