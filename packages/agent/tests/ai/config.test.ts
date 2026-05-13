import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, isPhaseTraceEnabled } from '../../src/zhin-agent/config.js';

describe('isPhaseTraceEnabled', () => {
  it('config.phaseTrace=true 时应直接开启', () => {
    expect(isPhaseTraceEnabled({ ...DEFAULT_CONFIG, phaseTrace: true }, {} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('config.phaseTrace=false 但环境变量开启时应开启', () => {
    expect(isPhaseTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false },
      { ZHIN_AGENT_PHASE_TRACE: '1' } as NodeJS.ProcessEnv,
    )).toBe(true);
  });

  it('配置与环境变量都未开启时应关闭', () => {
    expect(isPhaseTraceEnabled(
      { ...DEFAULT_CONFIG, phaseTrace: false },
      {} as NodeJS.ProcessEnv,
    )).toBe(false);
  });
});
