import { describe, expect, it } from 'vitest';
import { agentCommand } from '../src/commands/agent.js';

describe('zhin agent command', () => {
  it('no longer registers legacy migration subcommands', () => {
    const names = agentCommand.commands.map(command => command.name());
    expect(names).toContain('info');
    expect(names).toContain('workroom');
    expect(names).not.toContain('legacy-runs');
    expect(names).not.toContain('legacy-payloads');
  });
});
