import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveAgentHostExternalPeers,
  resolveAgentHostKnowledgeDirectory,
  resolveAgentHostMcpServers,
  resolveAgentHostVenues,
  resolveAiConfig,
} from '../../../src/plugin-runtime/agent/config.js';

describe('Agent Host configuration', () => {
  it('resolves only explicitly configured project-local knowledge directories', () => {
    const parent = mkdtempSync(join(tmpdir(), 'zhin-knowledge-config-'));
    const project = join(parent, 'project');
    const outside = join(parent, 'outside');
    mkdirSync(project);
    mkdirSync(outside);
    try {
      expect(resolveAgentHostKnowledgeDirectory({}, project)).toBeUndefined();
      expect(resolveAgentHostKnowledgeDirectory({ knowledge: { baseDir: 'knowledge' } }, project))
        .toBe(join(realpathSync(project), 'knowledge'));
      expect(() => resolveAgentHostKnowledgeDirectory({ knowledge: { baseDir: '../shared' } }, project))
        .toThrow('canonical project-relative path');
      expect(() => resolveAgentHostKnowledgeDirectory({ knowledge: {} } as never, project))
        .toThrow('non-empty canonical path');
      symlinkSync(outside, join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => resolveAgentHostKnowledgeDirectory({ knowledge: { baseDir: 'linked' } }, project))
        .toThrow('inside the project root');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('normalizes and validates MCP server declarations at the config boundary', () => {
    const args = ['server.js'];
    const entries = resolveAgentHostMcpServers({
      mcpServers: [{
        name: ' filesystem ',
        transport: 'stdio',
        command: 'node',
        args,
        env: { MODE: 'readonly' },
      }, {
        name: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.example/rpc',
      }],
    });
    expect(entries).toEqual([{
      name: 'filesystem',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { MODE: 'readonly' },
    }, {
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.example/rpc',
    }]);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries[0]?.args).not.toBe(args);
    expect(() => resolveAgentHostMcpServers({
      mcpServers: [{ name: 'missing-command', transport: 'stdio' }],
    } as never)).toThrow('Invalid ai.mcpServers[0] declaration');
    expect(() => resolveAgentHostMcpServers({
      mcpServers: [{ name: 'missing-url', transport: 'sse' }],
    } as never)).toThrow('Invalid ai.mcpServers[0] declaration');
  });

  it('normalizes and validates multi-bot Venue declarations', () => {
    expect(resolveAgentHostVenues(undefined)).toEqual([]);
    const venues = resolveAgentHostVenues({
      venues: [{
        id: ' dev-room ',
        label: ' Dev Room ',
        conversation: {
          platform: ' qq ',
          sceneType: 'group',
          sceneId: ' 123456 ',
        },
        members: [{
          agent: ' zhin ',
          botEndpoint: ' qq:main ',
          aliases: [' 小智 '],
        }, {
          agent: ' coder ',
          botEndpoint: ' qq:coder ',
        }],
        entry: ' zhin ',
        visibility: 'visible',
      }],
    });
    expect(venues).toEqual([{
      id: 'dev-room',
      label: 'Dev Room',
      conversation: {
        platform: 'qq',
        sceneType: 'group',
        sceneId: '123456',
      },
      members: [{
        agent: 'zhin',
        botEndpoint: 'qq:main',
        aliases: ['小智'],
      }, {
        agent: 'coder',
        botEndpoint: 'qq:coder',
      }],
      entry: 'zhin',
      visibility: 'visible',
    }]);
    expect(Object.isFrozen(venues)).toBe(true);

    expect(() => resolveAgentHostVenues({
      venues: [{
        id: 'broken',
        conversation: { platform: 'qq', sceneId: '1' },
        members: [],
      }],
    })).toThrow('members must be a non-empty array');
  });

  it('normalizes and validates external peer declarations', () => {
    expect(resolveAgentHostExternalPeers(undefined)).toEqual([]);
    const peers = resolveAgentHostExternalPeers({
      externalPeers: [{
        platform: ' qq ',
        userId: ' 999888 ',
        label: ' Partner Bot ',
      }],
    });
    expect(peers).toEqual([{
      platform: 'qq',
      userId: '999888',
      label: 'Partner Bot',
    }]);
    expect(Object.isFrozen(peers)).toBe(true);

    expect(() => resolveAgentHostExternalPeers({
      externalPeers: [
        { platform: 'qq', userId: '100' },
        { platform: 'qq', userId: '100' },
      ],
    })).toThrow('duplicate peer "qq:100"');
  });

  it('fails fast with a migration message when legacy ai.workroom is present', async () => {
    await expect(resolveAiConfig({ ai: { workroom: {} } })).rejects.toThrow(
      'Configuration key "ai.workroom" has been removed in ADR 0048',
    );
  });
});
