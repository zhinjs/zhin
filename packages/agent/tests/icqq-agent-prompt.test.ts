import { describe, it, expect } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { createIcqqAgentPromptContributor } from '../../../plugins/adapters/icqq/src/agent-prompt.js';

function t(name: string, desc = name): AgentTool {
  return {
    name,
    description: desc,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

describe('icqq AgentPromptContributor', () => {
  const contributor = createIcqqAgentPromptContributor();

  it('matchesDeferredTask for QQ like/send intents', () => {
    expect(contributor.matchesDeferredTask?.({
      slot: 'deferred_worker',
      toolContext: { platform: 'icqq' },
      toolSearch: true,
      deferred: { goal: '为 1659488338 点赞 10 次', toolQuery: 'icqq friend like' },
    })).toBe(true);
    expect(contributor.matchesDeferredTask?.({
      slot: 'deferred_worker',
      toolContext: { platform: 'icqq' },
      toolSearch: true,
      deferred: { goal: '成都天气', toolQuery: 'weather' },
    })).toBe(false);
  });

  it('selectDeferredTools prefers icqq MCP and excludes filesystem', () => {
    const catalog = [
      t('weather'),
      t('icqq_send_user_like', 'like friend'),
      t('mcp_icqq_icqq_invoke', 'icqq ipc'),
      t('mcp_filesystem_search_files', 'search files friend pattern'),
    ];
    const loaded = contributor.selectDeferredTools!(
      'icqq friend like',
      '为 1659488338 点赞 10 次',
      catalog,
      5,
    );
    expect(loaded!.map(x => x.name)).toContain('mcp_icqq_icqq_invoke');
    expect(loaded!.some(x => x.name.startsWith('mcp_filesystem_'))).toBe(false);
  });

  it('buildSections orchestrator when toolSearch', async () => {
    const sections = await contributor.buildSections({
      slot: 'orchestrator',
      toolContext: { platform: 'icqq' },
      toolSearch: true,
    });
    expect(sections?.[0].body).toMatch(/mcp_icqq/);
  });
});
