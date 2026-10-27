import { managementCommandText, managementCommandReference, type AgentCommandPresentation } from '../init/command-presentation.js';
import { taskMessages as t } from './interjection-messages.js';
/**
 * Interjection, redirect and stop for detached tasks (#732, roadmap M5.4).
 *
 * When a user writes in a session that has an active background task:
 *  - stop     → abort the task (`DetachedTaskRunner.cancel`)
 *  - redirect → queue steering for the next step boundary (`DetachedTaskRunner.steer`)
 *  - unrelated → not handled; the message becomes an ordinary new turn
 *
 * A product `TurnIntentResolver` (turn-intent-resolver.ts) may decide first:
 * its `steer` intent means redirect, `new` means unrelated. Without one, a
 * conservative built-in rule applies: only explicit stop words and explicit
 * redirect phrasing are taken; everything else stays an ordinary turn.
 */
import { isCancelIntent } from '../turn/cancel-intent.js';
import type { TurnIntentKind } from '../turn/turn-ingress.js';
import type { DetachedTaskRunner } from './runner.js';
import { TERMINAL_DETACHED_TASK_STATUSES, type DetachedTaskRecord, type DetachedTaskStatusName } from './types.js';

export type TaskInterjectionKind = 'stop' | 'redirect' | 'unrelated';

const STOP_PATTERNS = [
  /^(?:停|停止|停下|别做了|不用做了|算了|叫停|中止|终止)(?:吧|了|任务|这个任务|后台任务)?[。!！]?$/u,
  /^(?:stop|abort|halt)(?: (?:it|the task|task))?[.!]?$/iu,
];
const REDIRECT_PATTERNS = [
  /^(?:改成|改为|换成|换个方向|改方向|改一下|调整为|不要.+(?:而是|改成|换成)|别.+(?:改成|换成))/u,
  /^(?:instead|change (?:it |the task )?to|switch to|redirect)\b/iu,
];

/** Built-in conservative classifier; `productIntent` (from a TurnIntentResolver) wins when given. */
export function classifyTaskInterjection(text: string, productIntent?: TurnIntentKind): TaskInterjectionKind {
  const trimmed = text.trim();
  if (!trimmed) return 'unrelated';
  if (isCancelIntent(trimmed) || STOP_PATTERNS.some((re) => re.test(trimmed))) return 'stop';
  if (productIntent === 'steer') return 'redirect';
  if (productIntent === 'new' || productIntent === 'observe') return 'unrelated';
  return REDIRECT_PATTERNS.some((re) => re.test(trimmed)) ? 'redirect' : 'unrelated';
}

const ACTIVE: ReadonlySet<DetachedTaskStatusName> = new Set(['queued', 'running', 'waiting_approval', 'paused']);

export function isActiveDetachedTask(task: DetachedTaskRecord): boolean {
  return ACTIVE.has(task.status);
}

export interface TaskInterjectionActor {
  readonly sessionId: string;
  readonly senderId?: string;
  readonly isMaster?: boolean;
}

function mayControl(task: DetachedTaskRecord, actor: TaskInterjectionActor): boolean {
  if (task.sessionId !== actor.sessionId) return false;
  return actor.isMaster === true || !task.createdBy || task.createdBy === actor.senderId;
}

/** Most recently updated active task in the session that the actor may control. */
export async function findControllableTask(
  runner: DetachedTaskRunner,
  actor: TaskInterjectionActor,
): Promise<DetachedTaskRecord | undefined> {
  const tasks = (await runner.list()).filter((t) => isActiveDetachedTask(t) && mayControl(t, actor));
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export interface TaskInterjectionResult {
  readonly handled: boolean;
  readonly kind: TaskInterjectionKind;
  readonly taskId?: string;
  readonly reply?: string;
}

/** Route one inbound message against the session's active task. */
export async function routeTaskInterjection(
  runner: DetachedTaskRunner,
  actor: TaskInterjectionActor,
  text: string,
  productIntent?: TurnIntentKind,
  presentation: AgentCommandPresentation = {},
): Promise<TaskInterjectionResult> {
  const task = await findControllableTask(runner, actor);
  if (!task) return { handled: false, kind: 'unrelated' };
  const kind = classifyTaskInterjection(text, productIntent);
  if (kind === 'stop') {
    await runner.cancel(task.taskId);
    return { handled: true, kind, taskId: task.taskId, reply: t(presentation.locale, 'stoppedReply', { id: task.taskId }) };
  }
  if (kind === 'redirect') {
    await runner.steer(task.taskId, text.trim());
    return { handled: true, kind, taskId: task.taskId, reply: t(presentation.locale, 'redirected', { id: task.taskId }) };
  }
  return { handled: false, kind, taskId: task.taskId };
}

function preview(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * `/tasks`, `/task stop <id>`, `/task redirect <id> <text>`.
 * Returns the reply text, or null when the message is not a task command.
 */
export async function handleDetachedTaskCommand(
  runner: DetachedTaskRunner,
  actor: TaskInterjectionActor,
  content: string,
  presentation: AgentCommandPresentation = {},
): Promise<string | null> {
  const text = managementCommandText(content, presentation.commandPrefix);
  if (text === undefined) return null;
  const locale = presentation.locale;
  const taskCommand = managementCommandReference('task', presentation.commandPrefix)!;
  if (/^tasks$/iu.test(text)) {
    const tasks = (await runner.list())
      .filter((t) => t.sessionId === actor.sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const active = tasks.filter(isActiveDetachedTask);
    const recent = tasks.filter((t) => TERMINAL_DETACHED_TASK_STATUSES.has(t.status)).slice(0, 5);
    if (active.length === 0 && recent.length === 0) return t(locale, 'empty');
    const line = (task: DetachedTaskRecord) => t(locale, 'line', { id: task.taskId, status: t(locale, task.status), steps: task.steps.length, goal: preview(task.goal) });
    return [
      ...(active.length ? [t(locale, 'active'), ...active.map(line)] : [t(locale, 'inactive')]),
      ...(recent.length ? [t(locale, 'recent'), ...recent.map(line)] : []),
    ].join('\n');
  }
  // Whitespace split — linear in input length; no overlapping regex quantifiers (CodeQL ReDoS).
  // "/task redirect <id> <text with spaces>" keeps everything after the id as the new goal.
  const parts = text.split(/\s+/u);
  if (parts[0]?.toLowerCase() !== 'task') return null;
  const action = parts[1]?.toLowerCase();
  if (action !== 'stop' && action !== 'redirect') {
    return t(locale, 'usage', { tasks: managementCommandReference('tasks', presentation.commandPrefix)!, task: taskCommand });
  }
  const id = parts[2];
  if (!id) return t(locale, action === 'redirect' ? 'redirectUsage' : 'stopUsage', { task: taskCommand });
  // Rebuild the trailing text without re-scanning with an ambiguous regex.
  const rest = action === 'redirect' && parts.length > 3 ? parts.slice(3).join(' ') : undefined;
  const task = await runner.get(id);
  if (!task || !mayControl(task, actor)) return t(locale, 'notFound', { id });
  if (!isActiveDetachedTask(task)) return t(locale, 'terminal', { id, status: t(locale, task.status) });
  if (action === 'stop') {
    await runner.cancel(id);
    return t(locale, 'stopped', { id });
  }
  if (!rest?.trim()) return t(locale, 'redirectUsage', { task: taskCommand });
  await runner.steer(id, rest.trim());
  return t(locale, 'redirected', { id });
}
