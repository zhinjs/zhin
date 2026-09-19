import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertFixedWorkroomStorageMode,
  assessWorkroomDisclosureSetup,
  isWorkroomPlanningPolicyReady,
  resolveAgentHostMcpServers,
  resolveAgentHostKnowledgeDirectory,
  resolveWorkroomDisclosureAuthorityPublication,
  resolveWorkroomDisclosureBootstrap,
  resolveWorkroomPlanningPolicyPublication,
  resolveWorkroomStorageMode,
  resolveWorkroomTrustedPackPublishers,
} from '../../src/plugin-runtime/agent-host-config.js';

describe('Agent Host Workroom configuration', () => {
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

  it('validates the process-owned trusted Pack publisher list', () => {
    expect(resolveWorkroomTrustedPackPublishers({
      workroom: { trustedPackPublishers: ['workroom-admin'] },
    })).toEqual(['workroom-admin']);
    expect(() => resolveWorkroomTrustedPackPublishers({
      workroom: { trustedPackPublishers: ['workroom-admin', 'workroom-admin'] },
    })).toThrow('contains duplicates');
  });

  it('resolves the orchestrator model disclosure contract without inferring privacy', () => {
    const contract = {
      endpoint: 'https://models.example/v1', processingRegions: ['global'],
      maxConfidentiality: 'project_internal' as const, external: true, noTraining: true,
      loggingMode: 'metadata_only' as const, maximumRetentionSeconds: 60,
      allowsRedisclosure: false, supportsDeletion: true,
    };
    const resolution = resolveWorkroomDisclosureBootstrap({
      name: 'Zhin', members: [{ agent: 'planner', role: 'orchestrator' }],
      conversation: {
        adapter: 'sandbox', endpoint: 'main', kind: 'channel', id: 'zhin', agent: 'planner',
      },
    }, agentId => agentId === 'planner' ? 'openrouter' : undefined, {
      workroom: { disclosure: { modelProviders: { openrouter: contract } } },
    });
    expect(resolution).toEqual({ modelProviderAlias: 'openrouter', contract });
    expect(resolveWorkroomDisclosureBootstrap(undefined, () => 'openrouter', {})).toEqual({});
  });

  it('reports each fail-closed disclosure setup prerequisite', () => {
    expect(assessWorkroomDisclosureSetup({
      resolution: {}, authorityPublished: false, authorityCurrent: false, localIssuerAvailable: false,
    })).toMatchObject({
      disclosureReady: false,
      disclosureConfigReady: false,
      diagnostics: [
        'orchestrator 尚未绑定模型 Provider',
        '尚未发布 Project Data Governance 披露 authority',
        'Root-private Data Governance 签发能力不可用',
      ],
    });
    expect(assessWorkroomDisclosureSetup({
      resolution: { modelProviderAlias: 'openrouter' },
      authorityPublished: false,
      authorityCurrent: false,
      localIssuerAvailable: true,
    }).diagnostics).toContain('尚未配置 ai.workroom.disclosure.modelProviders.openrouter');
    expect(assessWorkroomDisclosureSetup({
      resolution: {
        modelProviderAlias: 'external',
        contract: {
          endpoint: 'https://models.example/v1', processingRegions: ['global'],
          maxConfidentiality: 'project_internal', external: true, noTraining: false,
          loggingMode: 'full', maximumRetentionSeconds: 60,
          allowsRedisclosure: false, supportsDeletion: false,
        },
      },
      authorityPublished: true,
      authorityCurrent: true,
      localIssuerAvailable: false,
    })).toMatchObject({
      disclosureReady: true,
      disclosureConfigReady: false,
      diagnostics: ['外部模型 Provider external 必须显式禁止训练'],
    });
    expect(assessWorkroomDisclosureSetup({
      resolution: {
        modelProviderAlias: 'public-only',
        contract: {
          endpoint: 'https://models.example/v1', processingRegions: ['local'],
          maxConfidentiality: 'public', external: false, noTraining: true,
          loggingMode: 'disabled', maximumRetentionSeconds: 1,
          allowsRedisclosure: false, supportsDeletion: true,
        },
      },
      authorityPublished: false,
      authorityCurrent: false,
      localIssuerAvailable: true,
    }).diagnostics).toContain('模型 Provider public-only 至少需要 project_internal 披露等级');
  });

  it('advances a stale disclosure authority through its CAS chain', () => {
    expect(assessWorkroomDisclosureSetup({
      resolution: {}, authorityPublished: true, authorityCurrent: false, localIssuerAvailable: true,
    })).toMatchObject({
      disclosureReady: false,
      diagnostics: expect.arrayContaining(['Project Data Governance 披露 authority 未绑定当前 Catalog/Sponsor']),
    });
    expect(resolveWorkroomDisclosureAuthorityPublication(undefined, false)).toEqual({ revision: 1 });
    expect(resolveWorkroomDisclosureAuthorityPublication({
      revision: 3,
      digest: `sha256:${'a'.repeat(64)}`,
    }, false)).toEqual({
      revision: 4,
      previousDigest: `sha256:${'a'.repeat(64)}`,
    });
    expect(resolveWorkroomDisclosureAuthorityPublication({
      revision: 3,
      digest: `sha256:${'a'.repeat(64)}`,
    }, true)).toBeUndefined();
  });

  it('advances and evaluates the Planning Policy authority', () => {
    expect(resolveWorkroomPlanningPolicyPublication(undefined)).toEqual({ revision: 1 });
    expect(resolveWorkroomPlanningPolicyPublication({ revision: 3, digest: 'sha256:previous' }))
      .toEqual({ revision: 4, expectedPreviousDigest: 'sha256:previous' });
    expect(isWorkroomPlanningPolicyReady(undefined)).toBe(false);
    expect(isWorkroomPlanningPolicyReady({
      policy: { schedulerPolicy: { pinnedAtSequence: 0 } },
    })).toBe(false);
    expect(isWorkroomPlanningPolicyReady({
      policy: { schedulerPolicy: { pinnedAtSequence: 1 } },
    })).toBe(true);
  });

  it('fixes the Workroom storage authority for the process lifetime', () => {
    expect(resolveWorkroomStorageMode(undefined)).toBe('database');
    expect(resolveWorkroomStorageMode({ sessions: { useDatabase: false } } as never)).toBe('file');
    expect(() => assertFixedWorkroomStorageMode('database', 'file'))
      .toThrow('process restart required');
    expect(() => assertFixedWorkroomStorageMode('file', 'database'))
      .toThrow('process restart required');
    expect(() => assertFixedWorkroomStorageMode('database', 'database')).not.toThrow();
  });
});
