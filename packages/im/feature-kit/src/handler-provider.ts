import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from './provider.js';
import { typeScriptModules } from './typescript-convention.js';
import { parseHandlerDefinition, HandlerIndex } from './handler.js';

export const handlerFeatureId = featureId('zhin.handler');

const handlerFeature = defineFeatureProvider({
  protocol: 1,
  id: handlerFeatureId,
  authoring: {
    setupMethod: 'addHandler',
    conventions: [typeScriptModules({
      id: 'handlers-ts',
      directory: 'handlers',
      separator: '.',
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
