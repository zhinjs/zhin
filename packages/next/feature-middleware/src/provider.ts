import { featureId } from '@zhin.js/next-kernel';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/next-feature-kit';
import { parseMiddlewareDefinition } from './definition.js';
import { MiddlewareIndex } from './middleware-index.js';

export const middlewareFeatureId = featureId('zhin.middleware');

const middlewareFeature = defineFeatureProvider({
  protocol: 1,
  id: middlewareFeatureId,
  authoring: {
    conventions: [typeScriptModules({
      id: 'middlewares-ts',
      directory: 'middlewares',
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
