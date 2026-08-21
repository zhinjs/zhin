import { describe, expect, it } from 'vitest';
import { WorkflowPlanBuilder } from '../../src/workroom/workflow-plan-builder.js';

describe('WorkflowPlanBuilder', () => {
  it('builds a deterministic immutable Plan proposal without mutating prior builders', () => {
    const base = WorkflowPlanBuilder.create({
      proposalId: 'proposal-1',
      projectId: 'project-1',
      strategy: { id: 'strategy:software-change', version: '1.0.0', digest: 'sha256:strategy' },
      parameterDigest: 'sha256:parameters',
    });
    const withBuild = base.addTask({
      key: 'build', title: 'Implement change', role: 'developer', required: true, maxAttempts: 2,
      dependsOn: ['research'],
      requires: { tools: ['tool:test', 'tool:repo'], skills: ['skill:implementation'] },
    });
    const complete = withBuild.addTask({
      key: 'research', title: 'Inspect constraints', role: 'architect', required: true, maxAttempts: 1,
      dependsOn: [], requires: { tools: ['tool:repo'], skills: ['skill:architecture'] },
    });
    const reordered = base
      .addTask({
        key: 'research', title: 'Inspect constraints', role: 'architect', required: true, maxAttempts: 1,
        dependsOn: [], requires: { skills: ['skill:architecture'], tools: ['tool:repo'] },
      })
      .addTask({
        key: 'build', title: 'Implement change', role: 'developer', required: true, maxAttempts: 2,
        dependsOn: ['research'],
        requires: { skills: ['skill:implementation'], tools: ['tool:repo', 'tool:test'] },
      });

    expect(() => base.build()).toThrow('at least one Task');
    expect(() => withBuild.build()).toThrow('unknown dependency');
    expect(complete.build()).toEqual(reordered.build());
    expect(complete.build()).toMatchObject({
      version: 1,
      proposalId: 'proposal-1',
      projectId: 'project-1',
      tasks: [{ key: 'build' }, { key: 'research' }],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(complete.build().tasks[0]?.requires.tools)).toBe(true);
  });

  it('rejects cycles, duplicate task identity and malformed typed requirements', () => {
    const builder = WorkflowPlanBuilder.create({
      proposalId: 'proposal-1', projectId: 'project-1',
      strategy: { id: 'strategy:content', version: '1.0.0', digest: 'sha256:strategy' },
      parameterDigest: 'sha256:parameters',
    })
      .addTask({
        key: 'draft', title: 'Draft', role: 'writer', required: true, maxAttempts: 1,
        dependsOn: ['edit'], requires: { skills: ['skill:writing'] },
      })
      .addTask({
        key: 'edit', title: 'Edit', role: 'editor', required: true, maxAttempts: 1,
        dependsOn: ['draft'], requires: { skills: ['skill:editing'] },
      });

    expect(() => builder.build()).toThrow('cycle');
    expect(() => builder.addTask({
      key: 'draft', title: 'Other', role: 'writer', required: true, maxAttempts: 1,
      dependsOn: [], requires: {},
    })).toThrow('already exists');
    expect(() => WorkflowPlanBuilder.create({
      proposalId: 'proposal-2', projectId: 'project-1',
      strategy: { id: 'strategy:bad', version: '1.0.0', digest: 'sha256:strategy' },
      parameterDigest: 'sha256:parameters',
    }).addTask({
      key: 'publish', title: 'Publish', role: 'integration', required: true, maxAttempts: 1,
      dependsOn: [], requires: { authorities: [''] },
    })).toThrow('non-empty');
  });

  it('rejects a non-boolean required flag at the public runtime boundary', () => {
    const builder = WorkflowPlanBuilder.create({
      proposalId: 'proposal-runtime-validation',
      projectId: 'project-1',
      strategy: { id: 'strategy:runtime', version: '1.0.0', digest: 'sha256:strategy' },
      parameterDigest: 'sha256:parameters',
    });

    expect(() => builder.addTask({
      key: 'optional',
      title: 'Optional task',
      role: 'worker',
      required: 'false' as unknown as boolean,
      maxAttempts: 1,
      dependsOn: [],
      requires: {},
    })).toThrow('required must be a boolean');
  });
});
