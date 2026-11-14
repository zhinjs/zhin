import { describeApprovalChannelConflicts } from '../../src/security/approval-channel-conflicts.js';

describe('describeApprovalChannelConflicts (#1250)', () => {
  it('reports ask as a conflict even without scheduled tasks', () => {
    const [conflict] = describeApprovalChannelConflicts({ execApprovalMode: 'ask', confirmHighRisk: 'off', unattendedChannels: [] });
    expect(conflict).toContain('execApprovalMode 为 ask');
    expect(conflict).toContain('无人值守');
  });

  it('reports provenance confirmation only when unattended turns can reach high-risk tools', () => {
    expect(describeApprovalChannelConflicts({ unattendedChannels: [] })).toEqual([]);
    expect(describeApprovalChannelConflicts({ confirmHighRisk: 'off', unattendedChannels: ['定时任务'] })).toEqual([]);
    const conflicts = describeApprovalChannelConflicts({ execApprovalMode: 'auto', unattendedChannels: ['定时任务', '助理提醒'] });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('定时任务、助理提醒');
  });
});
