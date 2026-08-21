import { describe, expect, it } from 'vitest';
import {
  WorkroomA2aAuthRegistry,
  type WorkroomA2aAuthBindingInput,
} from '../src/workroom-auth-registry.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

describe('WorkroomA2aAuthRegistry', () => {
  it('authenticates a configured credential into one immutable endpoint authority snapshot', () => {
    const registry = new WorkroomA2aAuthRegistry({
      generation: 3,
      bindings: [binding()],
      now: () => 1_000,
    });

    const authority = registry.authenticate('credential-secret-1');

    expect(authority).toEqual({
      version: 1,
      endpointId: 'a2a-primary',
      tenantId: 'tenant-1',
      cardDigest: SHA_A,
      authBindingId: 'auth-binding-1',
      trustDomain: 'workroom.example',
      generation: 3,
      extensionDigest: SHA_B,
      credentialIdDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(registry.snapshot).toMatchObject({ version: 1, generation: 3 });
    expect(Object.isFrozen(registry.snapshot)).toBe(true);
    expect(Object.isFrozen(registry.snapshot.bindings)).toBe(true);
    expect(Object.isFrozen(registry.snapshot.bindings[0])).toBe(true);
    expect(JSON.stringify(registry.snapshot)).not.toContain('credential-secret-1');
    expect(JSON.stringify(registry.snapshot)).not.toContain('credential-1');
  });

  it('resolves secure-provider credentials at generation registration time', () => {
    const requested: string[] = [];
    const registry = new WorkroomA2aAuthRegistry({
      generation: 4,
      bindings: [binding({
        credential: { source: 'secure_provider', secretRef: 'vault://a2a/primary' },
      })],
      secureCredentialProvider: {
        resolve(secretRef) {
          requested.push(secretRef);
          return 'vault-secret-1';
        },
      },
      now: () => 1_000,
    });

    expect(requested).toEqual(['vault://a2a/primary']);
    expect(registry.authenticate('vault-secret-1')).toMatchObject({
      endpointId: 'a2a-primary', generation: 4,
    });
    expect(JSON.stringify(registry.snapshot)).not.toContain('vault://a2a/primary');
    expect(JSON.stringify(registry.snapshot)).not.toContain('vault-secret-1');
  });

  it.each([
    ['endpoint binding', [binding(), binding({
      credentialId: 'credential-2',
      credential: { source: 'config', value: 'credential-secret-2' },
    })], 'endpoint binding drift'],
    ['credential id', [binding(), binding({
      endpointId: 'a2a-secondary',
      authBindingId: 'auth-binding-2',
      credential: { source: 'config', value: 'credential-secret-2' },
    })], 'duplicate credentialId'],
    ['credential value', [binding(), binding({
      endpointId: 'a2a-secondary',
      authBindingId: 'auth-binding-2',
      credentialId: 'credential-2',
    })], 'duplicate credential value'],
    ['auth binding id', [binding(), binding({
      endpointId: 'a2a-secondary',
      credentialId: 'credential-2',
      credential: { source: 'config', value: 'credential-secret-2' },
    })], 'authBindingId drift'],
  ] as const)('fails closed on duplicate %s', (_name, bindings, message) => {
    expect(() => new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings,
      now: () => 1_000,
    })).toThrow(message);
  });

  it('rejects unknown, disabled and expired credentials without trusting callback claims', () => {
    const unknown = new WorkroomA2aAuthRegistry({
      generation: 1, bindings: [binding()], now: () => 1_000,
    });
    const disabled = new WorkroomA2aAuthRegistry({
      generation: 1, bindings: [binding({ enabled: false })], now: () => 1_000,
    });
    const expired = new WorkroomA2aAuthRegistry({
      generation: 1, bindings: [binding({ expiresAt: 1_000 })], now: () => 1_000,
    });

    expect(() => unknown.authenticate('wrong-length-secret')).toThrow('unknown or inactive');
    expect(() => disabled.authenticate('credential-secret-1')).toThrow('unknown or inactive');
    expect(() => expired.authenticate('credential-secret-1')).toThrow('unknown or inactive');
    expect(() => unknown.authenticate({
      credential: 'wrong',
      claimedEndpoint: {
        endpointId: 'a2a-primary',
        cardDigest: SHA_A,
        authBindingId: 'auth-binding-1',
      },
    } as unknown as string)).toThrow('unknown or inactive');
  });

  it('keeps HMR generations in separate immutable registry snapshots', () => {
    const generation1 = new WorkroomA2aAuthRegistry({
      generation: 1, bindings: [binding()], now: () => 1_000,
    });
    const generation2 = new WorkroomA2aAuthRegistry({
      generation: 2,
      bindings: [binding({
        cardDigest: SHA_B,
        credential: { source: 'config', value: 'credential-secret-2' },
      })],
      now: () => 1_000,
    });

    expect(generation1.authenticate('credential-secret-1')).toMatchObject({
      generation: 1, cardDigest: SHA_A,
    });
    expect(generation2.authenticate('credential-secret-2')).toMatchObject({
      generation: 2, cardDigest: SHA_B,
    });
    expect(() => generation2.authenticate('credential-secret-1')).toThrow('unknown or inactive');
    expect(generation1.snapshot).toMatchObject({
      generation: 1,
      bindings: [{ cardDigest: SHA_A }],
    });
  });

  it('fails closed on missing secure provider and unknown registration fields', () => {
    expect(() => new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [binding({
        credential: { source: 'secure_provider', secretRef: 'vault://missing' },
      })],
      now: () => 1_000,
    })).toThrow('secure credential provider is required');
    expect(() => new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [{ ...binding(), claimedEndpoint: 'attacker' } as WorkroomA2aAuthBindingInput],
      now: () => 1_000,
    })).toThrow('forbidden field claimedEndpoint');
    expect(() => new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [binding({
        credential: { source: 'secure_provider', secretRef: 'vault://invalid' },
      })],
      secureCredentialProvider: {} as { resolve(secretRef: string): string | undefined },
      now: () => 1_000,
    })).toThrow('provider resolve must be a function');
  });
});

function binding(
  overrides: Partial<WorkroomA2aAuthBindingInput> = {},
): WorkroomA2aAuthBindingInput {
  return {
    endpointId: 'a2a-primary',
    tenantId: 'tenant-1',
    cardDigest: SHA_A,
    authBindingId: 'auth-binding-1',
    trustDomain: 'workroom.example',
    extensionDigest: SHA_B,
    credentialId: 'credential-1',
    credential: { source: 'config', value: 'credential-secret-1' },
    enabled: true,
    expiresAt: 2_000,
    ...overrides,
  };
}
