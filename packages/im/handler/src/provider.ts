import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { parseHandlerDefinition } from './definition.js';
import { HandlerIndex } from './handler-index.js';

export const handlerFeatureId = featureId('zhin.handler');

const handlerFeature = defineFeatureProvider({
  protocol: 1,
  id: handlerFeatureId,
  authoring: {
    setupMethod: 'addHandler',
    conventions: [typeScriptModules({
      id: 'handlers-ts',
      directory: 'handlers',
    })],
    validate: parseHandlerDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new HandlerIndex(slots, context.snapshot) };
    },
  },
});

export { handlerFeature };
export default handlerFeature;
