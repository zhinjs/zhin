import { describe, expect, it, vi } from 'vitest';
import {
  createGenerationOwnedWorkroomGovernedOutboundComposition,
  GenerationOwnedWorkroomGovernedDispatchAuthority,
} from '../../src/plugin-runtime/workroom-governed-dispatch-composition.js';
import type {
  WorkroomDisclosureManifestAuthorityPort,
} from '../../src/plugin-runtime/workroom-data-governance-runtime.js';
import { remoteDisclosureFixture } from '../workroom/remote-disclosure-fixture.js';

describe('generation-owned governed dispatch composition', () => {
  it('resolves the current exact generation on every operation and retires without fallback', async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => ({ status: 'blocked' as const, reason: 'disclosure_denied' as const }));
    let current = { generation: 7, port: { revalidate: first } };
    const port = new GenerationOwnedWorkroomGovernedDispatchAuthority({
      generation: 7,
      signal: controller.signal,
      resolve: () => current,
    });
    const snapshot = remoteDisclosureFixture();
    await expect(port.revalidate(snapshot, new AbortController().signal)).resolves.toMatchObject({
      status: 'blocked', reason: 'disclosure_denied',
    });
    expect(first).toHaveBeenCalledTimes(1);

    current = { generation: 8, port: { revalidate: first } };
    await expect(port.revalidate(snapshot, new AbortController().signal))
      .rejects.toThrow('generation');
    controller.abort(new DOMException('retired', 'AbortError'));
    await expect(port.revalidate(snapshot, new AbortController().signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('never materializes Projection through a revalidate-only consumer adapter', () => {
    const port = new GenerationOwnedWorkroomGovernedDispatchAuthority({
      generation: 1,
      signal: new AbortController().signal,
      resolve: () => undefined,
    });
    expect(typeof port.revalidate).toBe('function');
  });

  it('binds Projection and Remote consumers to one exact generation authority', () => {
    const authority: WorkroomDisclosureManifestAuthorityPort = Object.freeze({
      materialize: async () => null,
      prepareProjection: async () => ({
        status: 'blocked', reason: 'project_authority_unavailable',
      }),
      revalidate: async () => ({
        status: 'blocked', reason: 'project_authority_unavailable',
      }),
    });
    const composition = createGenerationOwnedWorkroomGovernedOutboundComposition({
      generation: 7,
      signal: new AbortController().signal,
      runtime: { generation: 7, disclosureManifest: authority },
    });

    expect(composition.projection).toBe(authority);
    expect(composition.remote).toBeInstanceOf(GenerationOwnedWorkroomGovernedDispatchAuthority);
    expect(() => createGenerationOwnedWorkroomGovernedOutboundComposition({
      generation: 8,
      signal: new AbortController().signal,
      runtime: { generation: 7, disclosureManifest: authority },
    })).toThrow('generation');
  });
});
