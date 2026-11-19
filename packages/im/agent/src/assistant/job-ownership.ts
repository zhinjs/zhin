/**
 * #1250 b55: who may see and manage a persistent schedule job from chat (`schedule_list`,
 * `schedule_remove` / `schedule_pause` / `schedule_resume`). An owner sees and manages every job;
 * anyone else only the jobs they created themselves, and sees, but does not manage, the jobs that
 * deliver to the conversation they are speaking in. Group admins get no wider access.
 */
import type { ToolInvocationContext } from '@zhin.js/tool';
import { scheduleJobCreatorFromPrincipal } from './job-creator.js';
import type { ScheduleJob, ScheduleJobCreator } from './types.js';

type Caller = Pick<ToolInvocationContext, 'principal' | 'origin'>;

/** The caller holds the `owner` role (host trust; ADR 0056). */
export function isScheduleOwner(caller: Caller): boolean {
  return caller.principal.roles.includes('owner');
}

function sameChat(a: ScheduleJobCreator['chat'], b: ScheduleJobCreator['chat']): boolean {
  if (!a || !b) return !a && !b;
  return a.endpointId === b.endpointId && a.conversation.endpoint.adapter === b.conversation.endpoint.adapter;
}

/**
 * The job was created by the caller: the same `userId` and, as `scheduleJobCreatorFromPrincipal`
 * records it, the same account (platform and endpoint) — or, on both sides, none recorded. A job
 * without `createdBy` (Console, CLI, Profile) belongs to nobody here.
 */
export function isScheduleJobCreator(job: Pick<ScheduleJob, 'createdBy'>, caller: Caller): boolean {
  const creator = job.createdBy;
  if (!creator) return false;
  const current = scheduleJobCreatorFromPrincipal(caller.principal, caller.origin);
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

/** Refusal of a chat job change, without revealing anything about the job. */
export const SCHEDULE_JOB_NOT_YOURS = '这不是你创建的任务，只有任务的创建者或所有者可以管理它';

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
  if (!isScheduleOwner(caller) && !isScheduleJobCreator(job, caller)) return SCHEDULE_JOB_NOT_YOURS;
  if (job.source === 'profile') return profileJobChatMessage(job.id);
  return undefined;
}
