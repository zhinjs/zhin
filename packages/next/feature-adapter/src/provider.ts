import { featureId, type RuntimeSnapshot } from '@zhin.js/next-kernel';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/next-feature-kit';
import { AdapterIndex } from './adapter-index.js';
import { parseAdapterDefinition } from './definition.js';

export const adapterFeatureId = featureId('zhin.adapter');

const adapterFeature = defineFeatureProvider({
  protocol: 1,
  id: adapterFeatureId,
  authoring: {
    conventions: [typeScriptModules({
      id: 'adapters-ts',
      directory: 'adapters',
    })],
    validate: parseAdapterDefinition,
  },
  runtime: {
    async project(slots, context) {
      const index = await AdapterIndex.create(slots, context.snapshot);
      let previousIndex: AdapterIndex | undefined;
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          quiescePrevious(previous) {
            previousIndex = previousAdapterIndex(previous);
            return previousIndex?.close();
          },
          activateNext: () => index.start(),
          deactivateNext: () => index.stop(),
          resumePrevious() {
            previousIndex?.open();
          },
          openNext: () => index.open(),
        },
      };
    },
  },
});

function previousAdapterIndex(snapshot: RuntimeSnapshot): AdapterIndex | undefined {
  return snapshot.projections.get(adapterFeatureId) as AdapterIndex | undefined;
}

export { adapterFeature };
export default adapterFeature;
