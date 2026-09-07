import { platformSmokeSuites, tierForFrontmatter } from '../../scripts/adapter-meta.mjs';

describe('platform graduation smoke selection', () => {
  it.each([
    ['Stable', 'Stable'], ['PlatformStable', 'Platform Stable'],
    ['Advanced', 'Advanced'], ['Experimental', 'Experimental'],
  ])('preserves %s in adapter page metadata', (tier, display) => {
    expect(tierForFrontmatter(tier)).toBe(display);
  });
  it('keeps promoted platforms covered after their candidate marker is removed', () => {
    expect(platformSmokeSuites({
      candidate: { tier: 'Advanced', stabilityCandidate: true, label: 'Candidate', packageName: 'candidate' },
      promoted: { tier: 'PlatformStable', label: 'Promoted', packageName: 'promoted' },
      advanced: { tier: 'Advanced', label: 'Advanced', packageName: 'advanced' },
      experimental: { tier: 'Experimental', label: 'Experimental', packageName: 'experimental' },
    })).toEqual(['plugins/adapters/candidate/tests', 'plugins/adapters/promoted/tests']);
  });
});
