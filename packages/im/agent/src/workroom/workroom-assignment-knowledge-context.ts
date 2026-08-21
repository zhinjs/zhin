import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type { ProjectKnowledgeEntry, ProjectKnowledgeRegistry } from './project-knowledge-registry.js';
import type { ProjectProfileRegistry } from './profile-registry.js';

export interface WorkroomAssignmentKnowledgeContextRequest {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly role: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
}

export interface WorkroomAssignmentKnowledgeHandle {
  readonly knowledgeId: string;
  readonly kind: 'memory' | 'glossary';
  readonly governedContent: Readonly<{ ref: string; digest: string }>;
  readonly schema: Readonly<{ ref: string; digest: string }>;
  readonly sensitivity: 'standard' | 'restricted' | 'high';
  readonly entryDigest: string;
}

export interface WorkroomAssignmentKnowledgeProjection {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly role: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly knowledgeRevision: number;
  readonly handles: readonly WorkroomAssignmentKnowledgeHandle[];
  readonly digest: string;
}

export interface WorkroomGovernedKnowledgeContentReadInput {
  readonly purpose: 'assignment-context';
  readonly projectId: string;
  readonly assignmentId: string;
  readonly principalId: string;
  readonly taskKey: string;
  readonly role: string;
  readonly profileRevisionId: string;
  readonly profileDigest: string;
  readonly knowledgeRevision: number;
  readonly handle: WorkroomAssignmentKnowledgeHandle;
  readonly projectionDigest: string;
}

export interface WorkroomGovernedKnowledgeContent {
  readonly body: unknown;
  readonly contentDigest: string;
  readonly authorizationDigest: string;
}

/** P12-owned reader. It must reauthorize every exact Assignment read. */
export interface WorkroomGovernedKnowledgeContentReader {
  read(input: WorkroomGovernedKnowledgeContentReadInput): Promise<WorkroomGovernedKnowledgeContent | undefined>;
}

export interface WorkroomEphemeralAssignmentContextPublisher {
  publish(input: Readonly<{
    assignmentId: string;
    principalId: string;
    projection: WorkroomAssignmentKnowledgeProjection;
    contents: readonly Readonly<{
      knowledgeId: string;
      body: unknown;
      contentDigest: string;
      authorizationDigest: string;
    }>[];
    expectedHash: string;
  }>): Promise<Readonly<{ ref: string; hash: string }>>;
}

export class WorkroomAssignmentKnowledgeContextProjector {
  constructor(readonly options: Readonly<{
    profiles: Pick<ProjectProfileRegistry, 'read'>;
    knowledge: Pick<ProjectKnowledgeRegistry, 'read'>;
    contentReader?: WorkroomGovernedKnowledgeContentReader;
    publisher?: WorkroomEphemeralAssignmentContextPublisher;
  }>) {}

  async project(request: WorkroomAssignmentKnowledgeContextRequest): Promise<WorkroomAssignmentKnowledgeProjection> {
    requestHeader(request);
    const [profiles, knowledge] = await Promise.all([
      this.options.profiles.read(request.projectId),
      this.options.knowledge.read(request.projectId),
    ]);
    const pin = profiles.runPins[request.runId];
    const revision = profiles.revisions[request.profileRevisionId];
    if (!pin || pin.profileRevisionId !== request.profileRevisionId || pin.profileDigest !== request.profileDigest
      || !revision || revision.compiledDigest !== request.profileDigest
      || revision.compiledProfile.digest !== request.profileDigest) {
      throw new Error('Assignment Knowledge requires the exact persisted Run Profile pin');
    }
    const selected = [
      ...revision.compiledProfile.memories.map(definition => ({ kind: 'memory' as const, definition })),
      ...revision.compiledProfile.glossaries.map(definition => ({ kind: 'glossary' as const, definition })),
    ].filter(({ definition }) => definition.allowedRoles.includes(request.role)
      && (definition.taskKeys.length === 0 || definition.taskKeys.includes(request.taskKey)));
    const byId = new Map(knowledge.entries.map(entry => [entry.knowledgeId, entry]));
    const handles = selected.map(({ kind, definition }) => {
      const entry = byId.get(definition.id);
      if (!entry || entry.projectId !== request.projectId || entry.kind !== kind || entry.digest !== definition.digest) {
        throw new Error(`Assignment Knowledge ${kind} ${definition.id} is unavailable or stale`);
      }
      return knowledgeHandle(entry);
    }).sort((left, right) => `${left.kind}:${left.knowledgeId}`.localeCompare(`${right.kind}:${right.knowledgeId}`));
    const body = deepFreeze({
      version: 1 as const,
      projectId: request.projectId,
      runId: request.runId,
      taskKey: request.taskKey,
      role: request.role,
      profileRevisionId: request.profileRevisionId,
      profileDigest: request.profileDigest,
      knowledgeRevision: knowledge.revision,
      handles,
    });
    return deepFreeze({ ...body, digest: digest(body) });
  }

  async materialize(input: Readonly<{
    request: WorkroomAssignmentKnowledgeContextRequest;
    assignmentId: string;
    principalId: string;
  }>): Promise<Readonly<{
    projection: WorkroomAssignmentKnowledgeProjection;
    contextView: Readonly<{ ref: string; hash: string }>;
  }>> {
    const reader = this.options.contentReader;
    const publisher = this.options.publisher;
    if (!reader || !publisher) throw new Error('Assignment Knowledge P12 reader/publisher is unavailable');
    const assignmentId = text(input.assignmentId, 'Assignment Knowledge assignmentId');
    const principalId = text(input.principalId, 'Assignment Knowledge principalId');
    const projection = await this.project(input.request);
    const contents = await Promise.all(projection.handles.map(async handle => {
      const governed = await reader.read({
        purpose: 'assignment-context',
        projectId: projection.projectId,
        assignmentId,
        principalId,
        taskKey: projection.taskKey,
        role: projection.role,
        profileRevisionId: projection.profileRevisionId,
        profileDigest: projection.profileDigest,
        knowledgeRevision: projection.knowledgeRevision,
        handle,
        projectionDigest: projection.digest,
      });
      if (!governed || governed.contentDigest !== handle.governedContent.digest) {
        throw new Error(`Assignment Knowledge P12 read denied or stale for ${handle.knowledgeId}`);
      }
      requiredDigest(governed.authorizationDigest, 'Assignment Knowledge authorization digest');
      return deepFreeze({
        knowledgeId: handle.knowledgeId,
        body: governed.body,
        contentDigest: governed.contentDigest,
        authorizationDigest: governed.authorizationDigest,
      });
    }));
    const expectedHash = digest({
      projectionDigest: projection.digest,
      assignmentId,
      principalId,
      contents: contents.map(({ body: _body, ...authority }) => authority),
    });
    const contextView = await publisher.publish({
      assignmentId, principalId, projection, contents, expectedHash,
    });
    if (contextView.hash !== expectedHash) throw new Error('Assignment Knowledge ephemeral Context hash drift');
    text(contextView.ref, 'Assignment Knowledge Context ref');
    return deepFreeze({ projection, contextView: { ...contextView } });
  }
}

function knowledgeHandle(entry: ProjectKnowledgeEntry): WorkroomAssignmentKnowledgeHandle {
  return deepFreeze({
    knowledgeId: entry.knowledgeId,
    kind: entry.kind,
    governedContent: { ...entry.governedContent },
    schema: { ...entry.schema },
    sensitivity: entry.sensitivity,
    entryDigest: entry.digest,
  });
}

function requestHeader(request: WorkroomAssignmentKnowledgeContextRequest): void {
  const keys = ['projectId', 'runId', 'taskKey', 'role', 'profileRevisionId', 'profileDigest'];
  if (canonicalWorkroomJson(Object.keys(request).sort()) !== canonicalWorkroomJson(keys.sort())) {
    throw new Error('Assignment Knowledge request keys are invalid');
  }
  text(request.projectId, 'Assignment Knowledge projectId');
  text(request.runId, 'Assignment Knowledge runId');
  text(request.taskKey, 'Assignment Knowledge taskKey');
  text(request.role, 'Assignment Knowledge role');
  text(request.profileRevisionId, 'Assignment Knowledge Profile revisionId');
  requiredDigest(request.profileDigest, 'Assignment Knowledge Profile digest');
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.startsWith('sha256:')) throw new Error(`${label} is invalid`);
  return result;
}
