import { describe, expect, it } from 'vitest';
import { numberedReminderList, reminderAccountName, resolveReminderRef } from '../src/task-ref.js';
import type { ReminderTask } from '../src/service.js';

const task = (id: string, text = id) => ({ id, text }) as ReminderTask;
const tasks = [task('a1b2c3d4-0000-4000-8000-000000000001', '喝水'), task('a1b2c3ff-0000-4000-8000-000000000002', '开会'),
  task('9f8e7d6c-0000-4000-8000-000000000003', '交周报')];

describe('reminder references (#1250)', () => {
  it('numbers remind list entries', () => {
    expect(numberedReminderList(tasks.slice(0, 2), item => item.text)).toBe('#1 喝水\n\n#2 开会');
  });

  it('resolves a list number, a full ID or a unique prefix of at least 6 characters', () => {
    expect(resolveReminderRef(tasks, '2', 'zh-CN')).toEqual({ kind: 'found', task: tasks[1] });
    expect(resolveReminderRef(tasks, '#3', 'zh-CN')).toEqual({ kind: 'found', task: tasks[2] });
    expect(resolveReminderRef(tasks, tasks[0]!.id, 'zh-CN')).toEqual({ kind: 'found', task: tasks[0] });
    expect(resolveReminderRef(tasks, '9f8e7d', 'zh-CN')).toEqual({ kind: 'found', task: tasks[2] });
  });

  it('explains an out-of-range number, a too short prefix, no match and an ambiguous prefix', () => {
    expect(resolveReminderRef(tasks, '4', 'zh-CN')).toMatchObject({ kind: 'error', message: expect.stringContaining('#4') });
    expect(resolveReminderRef(tasks, 'a1b2c', 'zh-CN')).toMatchObject({ kind: 'error', message: expect.stringContaining('6') });
    expect(resolveReminderRef(tasks, 'ffffff', 'zh-CN')).toMatchObject({ kind: 'error', message: '未找到你在此会话的提醒' });
    const ambiguous = resolveReminderRef(tasks, 'a1b2c3', 'zh-CN');
    expect(ambiguous.kind).toBe('error');
    expect(ambiguous.kind === 'error' && ambiguous.message).toContain('#1 a1b2c3d4');
    expect(ambiguous.kind === 'error' && ambiguous.message).toContain('#2 a1b2c3ff');
    expect(resolveReminderRef(tasks, 'a1b2c', 'en')).toMatchObject({ message: expect.stringContaining('at least 6') });
  });

  it('names the account by its Endpoint instance name', () => {
    expect(reminderAccountName({ endpointId: 'sandbox-bot' }, { id: 'root/sandbox\0zhin.adapter\0sandbox~x' })).toBe('sandbox-bot');
    expect(reminderAccountName(undefined, { id: 'root/sandbox\0zhin.adapter\0sandbox~sandbox-bot' })).toBe('sandbox-bot');
    expect(reminderAccountName({}, { id: 'plain' })).toBe('plain');
  });
});
