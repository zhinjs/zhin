import type {
  AgentProjectionIdentity,
  ConversationAddress,
  ObservableKernelFact,
  SpaceBinding,
} from './workroom-projection.ts';

export const workroomConversation: ConversationAddress = Object.freeze({
  endpointOwner: '@zhin.js/adapter-slack',
  endpointId: 'slack-main',
  kind: 'channel',
  id: 'project-zhin',
  parentId: 'workspace-acme',
});

export const sponsorConversation: ConversationAddress = Object.freeze({
  endpointOwner: '@zhin.js/adapter-slack',
  endpointId: 'slack-main',
  kind: 'channel',
  id: 'sponsor-portfolio',
  parentId: 'workspace-acme',
});

export const chatConversation: ConversationAddress = Object.freeze({
  endpointOwner: '@zhin.js/adapter-slack',
  endpointId: 'slack-main',
  kind: 'group',
  id: 'general-chat',
});

export const architect: AgentProjectionIdentity = Object.freeze({
  agentDefinitionId: 'software.architect',
  displayName: 'Architect',
  role: 'executor',
  aliases: ['architect', '架构师'],
  assignmentId: 'assignment-architecture-1',
  taskKey: 'architecture',
  taskRevision: 1,
});

export const secondArchitect: AgentProjectionIdentity = Object.freeze({
  agentDefinitionId: 'software.architect-secondary',
  displayName: 'Architect B',
  role: 'executor',
  aliases: ['architect', '架构师-b'],
  assignmentId: 'assignment-architecture-2',
  taskKey: 'architecture-review',
  taskRevision: 1,
});

export const orchestrator: AgentProjectionIdentity = Object.freeze({
  agentDefinitionId: 'software.orchestrator',
  displayName: 'Orchestrator',
  role: 'orchestrator',
  aliases: ['orchestrator', '主理人'],
});

export const developer: AgentProjectionIdentity = Object.freeze({
  agentDefinitionId: 'software.developer',
  displayName: 'Developer',
  role: 'executor',
  aliases: ['developer', '开发者'],
  assignmentId: 'assignment-docs-1',
  taskKey: 'documentation',
  taskRevision: 1,
});

export const bindings: readonly SpaceBinding[] = Object.freeze([
  Object.freeze({
    conversation: workroomConversation,
    space: 'workroom',
    revision: 1,
    effectiveAfterConversationSequence: 100,
    projectId: 'project-zhin',
  }),
  Object.freeze({
    conversation: sponsorConversation,
    space: 'sponsor_room',
    revision: 1,
    effectiveAfterConversationSequence: 50,
    sponsorRoomId: 'portfolio-engineering',
    projectIds: ['project-zhin', 'project-web'],
  }),
]);

export const facts: readonly ObservableKernelFact[] = Object.freeze([
  fact('f1', 1, 'run.started', 0, '启动 Workroom projection 设计。', orchestrator, 'both'),
  fact('f2', 2, 'task.started', 1, '开始审计 canonical ingress。', architect, 'workroom'),
  fact('f3', 3, 'task.progress', 5, '完成地址模型核对。', architect, 'workroom', 20),
  fact('f4', 4, 'task.progress', 12, '完成 reply provenance 设计。', architect, 'workroom', 55),
  fact('f5', 5, 'task.progress', 20, '完成 outbox 草案。', architect, 'workroom', 80),
  fact('f6', 6, 'task.milestone', 25, '投影契约原型已形成。', architect, 'workroom'),
  fact('f7', 7, 'approval.requested', 30, '需要 Sponsor 确认跨 Project 控制边界。', orchestrator, 'both'),
  fact('f8', 8, 'task.accepted', 40, 'Workroom projection 设计已验收。', orchestrator, 'both'),
  Object.freeze({
    id: 'f9', sequence: 9, projectId: 'project-web', runId: 'run-web-1', type: 'task.blocked',
    occurredAt: 42, text: '发布凭据缺失。', speaker: orchestrator, disclosure: 'sponsor',
    taskKey: 'publish', taskRevision: 1,
  }),
  fact('f10', 10, 'task.progress', 31, '完成文档目录。', developer, 'workroom', 30),
  fact('f11', 11, 'task.progress', 39, '完成主要章节。', developer, 'workroom', 70),
]);

function fact(
  id: string,
  sequence: number,
  type: ObservableKernelFact['type'],
  occurredAt: number,
  text: string,
  speaker: AgentProjectionIdentity,
  disclosure: ObservableKernelFact['disclosure'],
  progress?: number,
): ObservableKernelFact {
  return Object.freeze({
    id,
    sequence,
    projectId: 'project-zhin',
    runId: 'run-projection-1',
    type,
    occurredAt,
    text,
    speaker,
    disclosure,
    ...(speaker.taskKey ? { taskKey: speaker.taskKey } : {}),
    ...(speaker.taskRevision ? { taskRevision: speaker.taskRevision } : {}),
    ...(speaker.assignmentId ? { assignmentId: speaker.assignmentId } : {}),
    ...(progress === undefined ? {} : { progress }),
  });
}
