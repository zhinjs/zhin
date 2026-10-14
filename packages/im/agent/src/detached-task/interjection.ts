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
): Promise<TaskInterjectionResult> {
  const task = await findControllableTask(runner, actor);
  if (!task) return { handled: false, kind: 'unrelated' };
  const kind = classifyTaskInterjection(text, productIntent);
  if (kind === 'stop') {
    await runner.cancel(task.taskId);
    return { handled: true, kind, taskId: task.taskId, reply: `好的，已停止后台任务 ${task.taskId}。` };
  }
  if (kind === 'redirect') {
    await runner.steer(task.taskId, text.trim());
    return { handled: true, kind, taskId: task.taskId, reply: `收到，后台任务 ${task.taskId} 会在下一步按新要求调整。` };
  }
  return { handled: false, kind, taskId: task.taskId };
}

const STATUS_LABEL: Readonly<Record<DetachedTaskStatusName, string>> = {
  queued: '排队中',
  running: '运行中',
  waiting_approval: '等待确认',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

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
): Promise<string | null> {
  const text = content.trim();
  if (/^\/tasks$/iu.test(text)) {
    const tasks = (await runner.list())
      .filter((t) => t.sessionId === actor.sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const active = tasks.filter(isActiveDetachedTask);
    const recent = tasks.filter((t) => TERMINAL_DETACHED_TASK_STATUSES.has(t.status)).slice(0, 5);
    if (active.length === 0 && recent.length === 0) return '本会话没有后台任务。';
    const line = (t: DetachedTaskRecord) => `- ${t.taskId}｜${STATUS_LABEL[t.status]}｜${t.steps.length} 步｜${preview(t.goal)}`;
    return [
      ...(active.length ? ['进行中的后台任务：', ...active.map(line)] : ['没有进行中的后台任务。']),
      ...(recent.length ? ['最近结束：', ...recent.map(line)] : []),
    ].join('\n');
  }
  const match = /^\/task\s+(stop|redirect)(?:\s+(\S+))?(?:\s+([\s\S]+))?$/iu.exec(text);
  if (!match) return /^\/task(?:\s|$)/iu.test(text) ? '用法：/tasks、/task stop <id>、/task redirect <id> <新要求>' : null;
  const [, action, id, rest] = match;
  if (!id) return `用法：/task ${action.toLowerCase()} <id>${action.toLowerCase() === 'redirect' ? ' <新要求>' : ''}`;
  const task = await runner.get(id);
  if (!task || !mayControl(task, actor)) return `找不到可操作的后台任务 ${id}。`;
  if (!isActiveDetachedTask(task)) return `后台任务 ${id} 当前状态：${STATUS_LABEL[task.status]}，无法操作。`;
  if (action.toLowerCase() === 'stop') {
    await runner.cancel(id);
    return `已停止后台任务 ${id}。`;
  }
  if (!rest?.trim()) return '用法：/task redirect <id> <新要求>';
  await runner.steer(id, rest.trim());
  return `收到，后台任务 ${id} 会在下一步按新要求调整。`;
}
