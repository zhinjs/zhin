import { describe, expect, it } from 'vitest';
import { agentCommand } from '../src/commands/agent.js';

describe('zhin agent command', () => {
  it('no longer registers legacy migration subcommands', () => {
    const names = agentCommand.commands.map(command => command.name());
    expect(names).toContain('info');
    expect(names).not.toContain('workroom');
    expect(names).not.toContain('legacy-runs');
    expect(names).not.toContain('legacy-payloads');
  });
});

describe('zhin agent info (#1250 agent-info-misses-root-capabilities)', () => {
  it('has bilingual help and a --locale option like zhin setup', () => {
    const info = agentCommand.commands.find(command => command.name() === 'info')!;
    expect(agentCommand.description()).toBe('查看 Agent 能力 / Inspect Agent capabilities');
    expect(info.description()).toContain('按来源列出');
    expect(info.description()).toContain('List Agent tools');
    expect(info.options.map(option => option.long)).toEqual(expect.arrayContaining(['--json', '--locale']));
  });
});
