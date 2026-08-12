import { describe, expect, it } from 'vitest';
import { validateScheduleOutput } from '../../src/schedule-domain/output-validator.js';

describe('validateScheduleOutput', () => {
  it('strips leading and trailing meta commentary', () => {
    const result = validateScheduleOutput('收到，正在执行。\n\n上海今日 28°C，多云。\n\n如果还需要其他信息可以告诉我。');

    expect(result.valid).toBe(true);
    expect(result.cleaned).toBe('上海今日 28°C，多云。');
    expect(result.stripped).toHaveLength(2);
  });

  it('rejects output that contains only system markers', () => {
    const result = validateScheduleOutput('[任务] 已完成');
    expect(result.valid).toBe(false);
    expect(result.cleaned).toBe('');
  });

  it('removes a system marker without deleting the result on the same line', () => {
    const result = validateScheduleOutput('[任务] 北京晴，最高 30°C');
    expect(result.valid).toBe(true);
    expect(result.cleaned).toBe('北京晴，最高 30°C');
  });
});
