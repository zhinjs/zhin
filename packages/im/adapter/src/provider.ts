import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { AdapterIndex } from './adapter-index.js';
import { parseAdapterDefinition } from './definition.js';

export const adapterFeatureId = featureId('zhin.adapter');

const adapterFeature = defineFeatureProvider({
  protocol: 1,
  id: adapterFeatureId,
  authoring: {
    setupMethod: 'addAdapter',
    conventions: [directoryModules({
      id: 'adapters-index',
      layouts: [{ segments: ['adapters', capture('name')], localName: (values) => captured(values, 'name') }],
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
