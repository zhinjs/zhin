import { describe, it, expect } from 'vitest';
import { coerceGroupDelegateArgs } from '../../src/collaboration/collaboration-outbound.js';

describe('coerceGroupDelegateArgs', () => {
  it('parses object message and flat fields', () => {
    expect(coerceGroupDelegateArgs({
      message: {
        mentions: ['researcher'],
        text: 'go',
        requireArtifact: false,
        mode: 'pipeline',
      },
    })).toMatchObject({ text: 'go', requireArtifact: false, mode: 'pipeline' });

    expect(coerceGroupDelegateArgs({
      mentions: ['researcher'],
      text: 'go',
      requireArtifact: true,
      artifactKinds: ['report'],
    })).toMatchObject({ requireArtifact: true, artifactKinds: ['report'] });
  });
});
