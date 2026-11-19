/**
 * #1250 b55: who may see and manage a persistent schedule job from chat (`schedule_list`,
 * `schedule_remove` / `schedule_pause` / `schedule_resume`). An owner sees and manages every job;
 * anyone else only the jobs they created themselves, and sees, but does not manage, the jobs that
 * deliver to the conversation they are speaking in. Group admins get no wider access.
 *
 * Creatorship is only recognised between IM accounts: a creator or a caller without a recorded
 * chat (A2A, MCP, a due run, remote mail) is identified by a shared or self-reported `subjectId`
 * (`a2a-client`, `mcp-client`, `schedule`, a peer id), so such jobs belong to nobody here and only
 * an owner manages them.
 */
import type { ToolInvocationContext } from '@zhin.js/tool';
import { scheduleJobCreatorFromPrincipal } from './job-creator.js';
import type { ScheduleJob, ScheduleJobCreator } from './types.js';

type Caller = Pick<ToolInvocationContext, 'principal' | 'origin'>;

/** The caller holds the `owner` role (host trust; ADR 0056). */
export function isScheduleOwner(caller: Caller): boolean {
  return caller.principal.roles.includes('owner');
}

function sameChat(a: NonNullable<ScheduleJobCreator['chat']>, b: NonNullable<ScheduleJobCreator['chat']>): boolean {
  return a.endpointId === b.endpointId && a.conversation.endpoint.adapter === b.conversation.endpoint.adapter;
}

/**
 * The job was created by the caller: the same `userId` on the same IM account (platform and
 * endpoint), as `scheduleJobCreatorFromPrincipal` records it. A job without `createdBy` (Console,
 * CLI, Profile) or without a recorded chat (non-IM origin), and a caller outside IM, match nobody.
 */
export function isScheduleJobCreator(job: Pick<ScheduleJob, 'createdBy'>, caller: Caller): boolean {
  const creator = job.createdBy;
  if (!creator?.chat) return false;
  const current = scheduleJobCreatorFromPrincipal(caller.principal, caller.origin);
  if (!current.chat) return false;
  return creator.userId === current.userId && sameChat(creator.chat, current.chat);
}

/** The job delivers its results to the IM conversation the caller is speaking in. */
export function deliversToCurrentConversation(job: Pick<ScheduleJob, 'notify'>, caller: Caller): boolean {
  const origin = caller.origin;
  if (origin.kind !== 'im' || job.notify.channel !== 'im') return false;
  const scene = job.notify.target.scene;
  return scene.platform === origin.platform
    && scene.endpointKey === origin.endpoint
    && scene.sceneId === origin.sceneId
    && scene.kind === origin.scope;
}

/** `schedule_list`: the jobs the caller may see. */
export function scheduleJobVisibleTo(job: ScheduleJob, caller: Caller): boolean {
  return isScheduleOwner(caller) || isScheduleJobCreator(job, caller) || deliversToCurrentConversation(job, caller);
}

/**
 * Refusal of a chat job change to a non-owner: the same words whether the job does not exist or
 * is someone else's, so the reply reveals nothing about the job (not even that it exists).
 */
export function scheduleJobNotManageable(id: string): string {
  return `未找到你能管理的任务：${id}`;
}

/** A profile routine is re-declared from the Assistant Profile on every start. */
export function profileJobChatMessage(id: string): string {
  return `任务 ${id} 来自 Assistant Profile（routines），在聊天里修改会在重启后被还原。`
    + '请在 Profile 文件（assistant.profile.file，默认 assistant.profile.yml）中修改或删除该 routine';
}

/**
 * Whether the caller may remove, pause or resume `job` from chat: an owner any job except a profile
 * routine; anyone else only a job they created. `undefined`: allowed.
 */
export function scheduleJobChangeRefusal(job: ScheduleJob, caller: Caller): string | undefined {
  if (!isScheduleOwner(caller) && !isScheduleJobCreator(job, caller)) return scheduleJobNotManageable(job.id);
  if (job.source === 'profile') return profileJobChatMessage(job.id);
  return undefined;
}
