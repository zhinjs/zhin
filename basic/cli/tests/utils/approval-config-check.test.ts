import {
  CONFIRM_HIGH_RISK_OFF_FIX,
  CONFIRM_HIGH_RISK_OFF_MESSAGE,
  diagnoseApprovalChannelConfig,
} from '../../src/utils/approval-config-check.js';

describe('doctor approval channel check (#1250)', () => {
  it('warns that ask cannot be answered in unattended turns or by ordinary IM users', () => {
    const result = diagnoseApprovalChannelConfig({ ai: { agent: { execApprovalMode: 'ask' } } });
    expect(result).toMatchObject({ status: 'warn', message: expect.stringContaining('无人值守'), fix: expect.stringContaining('auto') });
  });

  it('explains the default provenance confirmation without warning', () => {
    expect(diagnoseApprovalChannelConfig({ ai: { agent: {} } })).toMatchObject({
      status: 'ok', message: expect.stringContaining('请发起人确认'),
    });
  });

  it('warns about every protection lost when confirmHighRisk is off, with a narrower alternative (ADR 0067 D5)', () => {
    const result = diagnoseApprovalChannelConfig({ ai: { agent: { injectionGuard: { confirmHighRisk: 'off' } } } });
    expect(result).toMatchObject({ status: 'warn', message: CONFIRM_HIGH_RISK_OFF_MESSAGE, fix: CONFIRM_HIGH_RISK_OFF_FIX });
    for (const lost of ['执行命令', '写文件', '向其他会话发消息', '修改配置', '定时任务']) expect(result?.message).toContain(lost);
    expect(result?.fix).toContain('schedule: off');
    expect(result?.fix).toContain('trustedOutputTools');
    const everyCategory = { shell: 'off', fileWrite: 'off', outbound: 'off', config: 'off', schedule: 'off' };
    expect(diagnoseApprovalChannelConfig({ ai: { agent: { injectionGuard: { confirmHighRisk: everyCategory } } } }))
      .toMatchObject({ status: 'warn' });
    expect(diagnoseApprovalChannelConfig({ ai: { agent: { execApprovalMode: 'ask', injectionGuard: { confirmHighRisk: 'off' } } } }))
      .toMatchObject({ status: 'warn', message: expect.stringContaining('已全部关闭') });
  });

  it('lists categories switched off one by one without warning', () => {
    expect(diagnoseApprovalChannelConfig({ ai: { agent: { injectionGuard: { confirmHighRisk: { schedule: 'off' } } } } }))
      .toMatchObject({ status: 'ok', message: expect.stringContaining('已关闭确认的类别：定时任务') });
  });

  it('explains that an explicit external_content string keeps the old strictness', () => {
    expect(diagnoseApprovalChannelConfig({ ai: { agent: { injectionGuard: { confirmHighRisk: 'external_content' } } } }))
      .toMatchObject({ status: 'ok', message: expect.stringContaining('ADR 0067') });
    expect(diagnoseApprovalChannelConfig({ ai: { agent: {} } })?.message).not.toContain('ADR 0067');
  });

  it('stays silent without AI', () => {
    expect(diagnoseApprovalChannelConfig({})).toBeUndefined();
    expect(diagnoseApprovalChannelConfig({ ai: { enabled: false, agent: { execApprovalMode: 'ask' } } })).toBeUndefined();
  });
});
