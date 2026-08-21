import { describe, expect, it } from 'vitest';
import {
  assertUserInteractionRequest,
  parseUserInteractionAnswer,
  projectUserInteraction,
  renderUserInteraction,
} from '../src/built/user-interaction.js';

describe('UserInteraction module', () => {
  it('renders title, description, tip and confirmation actions as canonical segments', () => {
    const view = projectUserInteraction({
      type: 'confirm',
      title: '删除项目',
      description: '此操作会删除所有未发布内容。',
      tip: '已发布内容不受影响。',
    });
    expect(renderUserInteraction(view)).toEqual([
      {
        type: 'markdown',
        data: {
          content: '### 删除项目\n\n此操作会删除所有未发布内容。\n\n> 💡 已发布内容不受影响。\n> 💡 请选择确认或取消。',
        },
      },
      {
        type: 'keyboard',
        data: {
          rows: [[
            expect.objectContaining({ label: '确认', payload: 'yes', mode: 'command' }),
            expect.objectContaining({ label: '取消', payload: 'no', mode: 'command' }),
          ]],
          fallback: {
            hint: '也可以直接回复对应内容。',
            map: { '1': 'yes', '2': 'no' },
          },
        },
      },
    ]);
  });

  it('projects sequence progress and option descriptions', () => {
    const view = projectUserInteraction({
      type: 'select',
      title: '部署环境',
      description: '请选择本次发布目标。',
      options: [
        { label: '开发', value: 'dev', description: '允许调试' },
        { label: '生产', value: 'prod', description: '对外服务' },
      ],
    }, {
      title: '发布向导',
      description: '完成以下配置。',
      tip: '可以随时取消。',
      index: 2,
      total: 3,
    });
    expect(view.title).toBe('发布向导');
    expect(view.description).toContain('**2/3 · 部署环境**');
    expect(view.description).toContain('2. 生产 — 对外服务');
    expect(view.actions).toHaveLength(2);
  });

  it('validates typed answers instead of settling with NaN or undefined', () => {
    expect(parseUserInteractionAnswer({ type: 'number', title: '年龄', min: 1 }, 'abc'))
      .toMatchObject({ ok: false });
    expect(parseUserInteractionAnswer({ type: 'number', title: '年龄', min: 1 }, '18'))
      .toEqual({ ok: true, value: 18 });
    expect(parseUserInteractionAnswer({
      type: 'select',
      title: '环境',
      options: [{ label: '开发', value: 'dev' }, { label: '生产', value: 'prod' }],
    }, '生产')).toEqual({ ok: true, value: 'prod' });
    expect(parseUserInteractionAnswer({ type: 'confirm', title: '确认' }, '随便说点什么'))
      .toMatchObject({ ok: false });
  });

  it('rejects ambiguous or impossible definitions before waiting for input', () => {
    expect(() => assertUserInteractionRequest({ type: 'select', title: '环境', options: [] }))
      .toThrow('options must not be empty');
    expect(() => assertUserInteractionRequest({
      type: 'select',
      title: '环境',
      options: [{ label: '生产', value: 1 }, { label: '生产', value: 2 }],
    })).toThrow('Duplicate');
    expect(() => assertUserInteractionRequest({ type: 'number', title: '数量', min: 10, max: 1 }))
      .toThrow('range is invalid');
  });
});
