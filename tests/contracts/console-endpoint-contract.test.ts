import { describe, expect, it } from 'vitest';
import { ENDPOINT_MANAGEMENT_CAPABILITIES } from '../../packages/console/protocol/src/index.js';
import { endpointManagementCapabilityIds } from '../../packages/im/adapter/src/index.js';
import { ADAPTER_META } from '../../scripts/adapter-meta.mjs';

describe('Console Endpoint management wire contract', () => {
  it('keeps Adapter method-derived ids aligned with the zero-dependency wire vocabulary', () => {
    expect([...endpointManagementCapabilityIds]).toEqual([
      ...ENDPOINT_MANAGEMENT_CAPABILITIES,
    ]);
  });

  it('keeps published Adapter management promises inside the wire vocabulary', () => {
    const known = new Set<string>(ENDPOINT_MANAGEMENT_CAPABILITIES);
    for (const meta of Object.values(ADAPTER_META)) {
      for (const capability of meta.management ?? []) {
        expect(known.has(capability), capability).toBe(true);
      }
    }
    expect(ADAPTER_META.icqq.management).toEqual([...endpointManagementCapabilityIds]);
    expect(ADAPTER_META.qq.management).toEqual(['listChannels']);
  });
});
