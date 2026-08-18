import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { AdapterIndex } from './adapter-index.js';
import { parseAdapterDefinition } from './definition.js';

export const adapterFeatureId = featureId('zhin.adapter');

const adapterFeature = defineFeatureProvider({
  protocol: 1,
  id: adapterFeatureId,
  authoring: {
    setupMethod: 'addAdapter',
    conventions: [typeScriptModules({
      id: 'adapters-ts',
      directory: 'adapters',
    })],
    validate: parseAdapterDefinition,
  },
  runtime: {
    async project(slots, context) {
      const index = await AdapterIndex.create(slots, context.snapshot, context.signal);
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          activateNext: (signal) => index.activate(signal),
          deactivateNext: () => index.stop(),
        },
      };
    },
  },
});

export { adapterFeature };
export default adapterFeature;
