import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { AdapterIndex } from './adapter-index.js';
// Native Feature entries have generation URLs. Host tokens must retain the
// canonical package identity rather than following that revisioned closure.
import { endpointDesiredRepositoryToken, endpointSecretResolverToken } from '@zhin.js/adapter';
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
    // Bound transport callbacks enter the current Host gateway; unrelated owner
    // updates need not reconnect accounts whose scopes and definitions are unchanged.
    retain: 'when-owner-unchanged',
    async project(slots, context) {
      const index = await AdapterIndex.create(slots, context.snapshot, context.signal, {
        repository: context.featureResource?.(endpointDesiredRepositoryToken),
        secrets: context.featureResource?.(endpointSecretResolverToken),
      });
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
