import { describe, expect, it } from 'vitest';
import {
  capabilityId,
  featureId,
  rootPluginId,
  type CapabilitySlot,
  type SetupCapabilityRegistration,
} from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import {
  addCapabilitySlot,
  featureSetupAliases,
  mergeSetupCapabilities,
} from '../src/setup-capabilities.js';

describe('setup Feature registration', () => {
  it('validates and projects registrations as setup-owned Capability Slots', () => {
    const owner = rootPluginId();
    const feature = featureId('test.inline');
    const provider = defineFeatureProvider({
      protocol: 1,
      id: feature,
      authoring: {
        conventions: [],
        validate(value) {
          if (value !== 'valid') throw new TypeError('invalid inline definition');
          return value;
        },
      },
      runtime: {
        project: () => ({ value: undefined }),
      },
    });
    const registration = Object.freeze({
      id: capabilityId(owner, feature, 'hello'),
      owner,
      feature,
      localName: 'hello',
      source: '/project/plugin.ts',
      definition: 'valid',
    }) satisfies SetupCapabilityRegistration;
    const capabilities = new Map();

    mergeSetupCapabilities(
      capabilities,
      [registration],
      new Map([[feature, provider]]),
      new Map([[feature, [{ owner, packageRoot: '/project' }]]]),
    );

    expect(capabilities.get(registration.id)).toMatchObject({
      owner,
      feature,
      localName: 'hello',
      definition: 'valid',
      origin: 'setup',
    });
    expect(() => mergeSetupCapabilities(
      capabilities,
      [registration],
      new Map([[feature, provider]]),
      new Map([[feature, [{ owner, packageRoot: '/project' }]]]),
    )).toThrow('Duplicate Capability Slot');
  });

  it('rejects registrations for a Feature not mounted by the owner', () => {
    const owner = rootPluginId();
    const feature = featureId('test.unmounted');
    const registration = {
      id: capabilityId(owner, feature, 'value'),
      owner,
      feature,
      localName: 'value',
      source: '/project/plugin.ts',
      definition: {},
    } satisfies SetupCapabilityRegistration;

    expect(() => mergeSetupCapabilities(
      new Map(),
      [registration],
      new Map(),
      new Map(),
    )).toThrow(`Feature ${feature} is not mounted for Plugin ${owner}`);
  });

  it('rejects collisions between setup and discovered slots', () => {
    const owner = rootPluginId();
    const feature = featureId('test.collision');
    const id = capabilityId(owner, feature, 'same');
    const capabilities = new Map([[id, {
      id,
      owner,
      feature,
      localName: 'same',
      source: '/project/plugin.ts',
      definition: {},
    } satisfies CapabilitySlot]]);

    expect(() => addCapabilitySlot(capabilities, {
      id,
      owner,
      feature,
      localName: 'same',
      source: '/project/commands/same.ts',
      definition: {},
    })).toThrow('Duplicate Capability Slot');
  });

  it('derives setup shortcuts from providers and rejects alias collisions', () => {
    const first = defineFeatureProvider({
      protocol: 1,
      id: featureId('test.first'),
      authoring: {
        setupMethod: 'addExample',
        conventions: [],
        validate: (value) => value,
      },
      runtime: { project: () => ({ value: undefined }) },
    });
    const second = defineFeatureProvider({
      protocol: 1,
      id: featureId('test.second'),
      authoring: {
        setupMethod: 'addExample',
        conventions: [],
        validate: (value) => value,
      },
      runtime: { project: () => ({ value: undefined }) },
    });

    expect(featureSetupAliases([first])).toEqual(new Map([
      ['addExample', first.id],
    ]));
    expect(() => featureSetupAliases([first, second]))
      .toThrow('Duplicate Feature setup method addExample');
  });
});
