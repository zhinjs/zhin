import { describe, it, expect } from 'vitest';
import {
  formatArtifactFeedSummary,
  formatArtifactSubmitFeedHeadline,
  formatDelegationFeedText,
  formatStageFeedText,
} from '../../src/collaboration/group-feed.js';

describe('group feed formatting', () => {
  it('formats delegation with role labels', () => {
    const text = formatDelegationFeedText('planner', 'researcher', 'Find pricing for product X');
    expect(text).toContain('规划员');
    expect(text).toContain('调研员');
    expect(text).toContain('Find pricing');
  });

  it('formats stage transition in Chinese', () => {
    expect(formatStageFeedText('planner', 'researcher')).toBe('阶段推进：规划 → 调研');
  });

  it('summarizes report artifact from summary field', () => {
    expect(formatArtifactFeedSummary('report', { summary: 'Three vendors compared' }))
      .toBe('Three vendors compared');
  });

  it('omits empty payload instead of showing {}', () => {
    expect(formatArtifactFeedSummary('deliverable', {})).toBeUndefined();
    expect(formatArtifactFeedSummary('report', { summary: '' })).toBeUndefined();
  });

  it('formats artifact submit headline in Chinese', () => {
    expect(formatArtifactSubmitFeedHeadline('report')).toBe('已提交调研报告');
  });

  it('summarizes review verdict in Chinese', () => {
    expect(formatArtifactFeedSummary('review', { approved: false, feedback: 'Missing citations' }))
      .toBe('需修改：Missing citations');
  });
});
