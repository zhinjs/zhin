import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import {
  installWorkroomDataGovernanceResources,
} from '../../src/plugin-runtime/workroom-data-governance-composition.js';
import { workroomPlanningDisclosureToken } from '../../src/plugin-runtime/workroom-dynamic-planning-provider.js';
import { workroomAssignmentDisclosureManifestAuthorityToken } from '../../src/plugin-runtime/workroom-assignment-authority-grant-runtime.js';
import {
  workroomEvidencePayloadWriterToken,
  workroomTaskReportPayloadToken,
} from '../../src/plugin-runtime/workroom-local-agent-loop.js';
import { workroomDisclosureManifestAuthorityToken } from '../../src/plugin-runtime/workroom-data-governance-runtime.js';
import { workroomAcceptanceProjectionPayloadToken } from '../../src/plugin-runtime/workroom-acceptance-fact-providers.js';

describe('standard Workroom Data Governance composition', () => {
  it('publishes only governed generation ports and durably blocks without Project/KMS authority', async () => {
    const projectRoot = join(tmpdir(), `zhin-governance-composition-${randomUUID()}`);
    await mkdir(join(projectRoot, '.zhin'), { recursive: true });
    const resources = new Scope(rootPluginId());
    installWorkroomDataGovernanceResources({
      projectRoot, generation: 8, signal: new AbortController().signal, resources,
    });
    expect(resources.has(workroomPlanningDisclosureToken)).toBe(true);
    expect(resources.has(workroomAssignmentDisclosureManifestAuthorityToken)).toBe(true);
    expect(resources.has(workroomEvidencePayloadWriterToken)).toBe(true);
    expect(resources.has(workroomTaskReportPayloadToken)).toBe(true);
    expect(resources.has(workroomAcceptanceProjectionPayloadToken)).toBe(true);
    expect(resources.has(workroomDisclosureManifestAuthorityToken)).toBe(true);

    await expect(resources.use(workroomEvidencePayloadWriterToken).write({
      mediaType: 'text/plain', content: 'must never land in blocker metadata',
      claimedSource: { kind: 'tool', locator: 'model-claimed-secret-locator' },
      attribution: {
        projectId: 'project-without-authority', runId: 'run-1', taskKey: 'task-1',
        taskRevision: 1, assignmentId: 'assignment-1', attempt: 1, fence: 1,
      },
      publication: {
        publish: async () => ({ publicationDigest: `sha256:${'a'.repeat(64)}` }),
      },
    }, new AbortController().signal)).rejects.toThrow('authority is unavailable');

    const blockerDirectory = join(
      projectRoot, '.zhin', 'workroom-data-governance-authority', 'blockers',
    );
    const names = await readdir(blockerDirectory);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.json$/u);
  });
});
