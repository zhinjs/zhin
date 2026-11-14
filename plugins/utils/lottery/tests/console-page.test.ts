import { describe, expect, it } from 'vitest';
import { evaluateDeclarativeValue } from '@zhin.js/console-contract';
import page from '../pages/index/index.ts';

type Entry = { label: unknown; dataKey?: string; value?: unknown; muted?: unknown; badge?: { label: unknown } };
const spec = (page as unknown as { spec: { sections: { id?: string; entries?: Entry[] }[]; stats: { key?: string; value: unknown }[] } }).spec;
const config = spec.sections.find(section => section.id === 'config')!.entries!;
const cron = config.find(entry => entry.dataKey === 'scheduleCron')!;

describe('lottery Console page schedule switch (#1250)', () => {
  it('greys out the cron and labels it 「未启用」 while scheduleEnabled is false', () => {
    const off = { scheduleEnabled: false, scheduleCron: '0 0 18 * * *' };
    expect(evaluateDeclarativeValue(cron.muted, off, 'zh-CN')).toBe('true');
    expect(evaluateDeclarativeValue(cron.badge!.label, off, 'zh-CN')).toBe('未启用');
    expect(evaluateDeclarativeValue(cron.badge!.label, off, 'en')).toBe('Disabled');
  });

  it('shows the cron normally while the schedule runs', () => {
    const on = { scheduleEnabled: true, scheduleCron: '0 0 18 * * *' };
    expect(evaluateDeclarativeValue(cron.muted, on, 'zh-CN')).toBe('false');
    expect(evaluateDeclarativeValue(cron.badge!.label, on, 'zh-CN')).toBe('');
  });

  it('states the switch itself, in both the stats and the details', () => {
    const stat = spec.stats.find(item => item.key === 'scheduleEnabled')!;
    expect(evaluateDeclarativeValue(stat.value, { scheduleEnabled: false }, 'zh-CN')).toBe('未启用');
    expect(evaluateDeclarativeValue(stat.value, { scheduleEnabled: true }, 'en')).toBe('Enabled');
    const switchEntry = config.find(entry => entry.dataKey === undefined && entry.value !== undefined)!;
    expect(evaluateDeclarativeValue(switchEntry.value, { scheduleEnabled: false }, 'zh-CN')).toBe('未启用');
  });
});
