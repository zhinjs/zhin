import { diagnoseApprovalChannelConfig } from '../../src/utils/approval-config-check.js';

describe('doctor approval channel check (#1250)', () => {
  it('warns that ask cannot be answered in unattended turns or by ordinary IM users', () => {
    const result = diagnoseApprovalChannelConfig({ ai: { agent: { execApprovalMode: 'ask' } } });
    expect(result).toMatchObject({ status: 'warn', message: expect.stringContaining('无人值守'), fix: expect.stringContaining('auto') });
  });

  it('explains the default provenance confirmation without warning', () => {
    expect(diagnoseApprovalChannelConfig({ ai: { agent: {} } })).toMatchObject({
      status: 'ok', message: expect.stringContaining('请发起人确认'),
    });
    expect(diagnoseApprovalChannelConfig({ ai: { agent: { injectionGuard: { confirmHighRisk: 'off' } } } }))
      .toMatchObject({ status: 'ok', message: expect.stringContaining('未开启') });
  });

  it('stays silent without AI', () => {
    expect(diagnoseApprovalChannelConfig({})).toBeUndefined();
    expect(diagnoseApprovalChannelConfig({ ai: { enabled: false, agent: { execApprovalMode: 'ask' } } })).toBeUndefined();
  });
});
