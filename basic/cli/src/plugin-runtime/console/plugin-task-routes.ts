import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { HttpBodyError, extractBearerToken, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import {
  GenerationAdmissionGate, generationAdmissionSource, normalizeDeliveryTarget,
  PluginTaskError, pluginTaskProviderToken, createMessages, isLocale, resolveLocale, type Locale,
  type CapabilityId, type DeliveryTarget, type JsonValue, type PluginId,
  type PluginTask, type PluginTaskAction, type PluginTaskMutationReceipt, type PluginTaskProvider, type PluginTaskSnapshot,
  type RuntimeSnapshot, type SnapshotLease, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { ConsolePluginTask, ConsolePluginTaskProvider } from '@zhin.js/console-protocol';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeJson } from './http-response.js';
import { listPluginUseCases } from '../../plugin-management/use-cases.js';

const taskMessages = createMessages({
  auth: { 'zh-CN': "请配置并使用有效的 full scope Bearer Token 管理管理员任务", en: "Configure and use a valid full-scope Bearer Token to manage administrator tasks." },
  body: { 'zh-CN': "请求正文无效或超过 64 KiB 上限", en: "The request body is invalid or exceeds 64 KiB." },
  invalid_input: { 'zh-CN': "任务参数无效，请核对字段与目标", en: "Invalid task parameters. Check the fields and destination." },
  conflict: { 'zh-CN': "运行代或任务版本已变化，请刷新后核对；不要盲目重试", en: "The generation or task revision changed. Refresh and reconcile before retrying." },
  not_found: { 'zh-CN': "任务服务或目标不存在", en: "The task service or destination does not exist." },
  unsupported: { 'zh-CN': "目标或操作不支持此任务", en: "This task is not supported for the destination or operation." },
  unavailable: { 'zh-CN': "任务服务未就绪或返回了无效数据", en: "The task service is not ready or returned invalid data." },
  internal_error: { 'zh-CN': "任务操作失败，请核对任务与请求回执后再决定是否重试", en: "The task operation failed. Check the task and request receipt before deciding whether to retry." },
});

const BODY_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const actions = new Set(['pause', 'resume', 'cancel', 'update']);
const states = new Set(['scheduled', 'paused', 'running', 'unknown', 'succeeded', 'failed', 'cancelled']);

/** Administrator task commands use the exact current owner service, never a parallel scheduler or transaction store. */
export function registerPluginTaskRoutes(options: Readonly<{ http: HttpHost; base: string; snapshots?: SnapshotReader }>): void {
  const { http, base, snapshots } = options;
  http.route('GET', `${base}/tasks/use-cases`, (request, response, url, authScope) => {
    const displayLocale = resolveLocale(url.searchParams.get('locale'));
    if (!authorize(request, response, http, authScope, displayLocale)) return;
    try { send(response, listPluginUseCases(queryLocale(url))); }
    catch (error) { failure(response, error, displayLocale); }
  }, { summary: 'List practical plugin use cases', tags: ['tasks'], description: 'Static metadata only; no plugin execution, configuration changes or message delivery.' });
  http.route('GET', `${base}/tasks/providers`, async (request, response, url, authScope) => {
    const displayLocale = resolveLocale(url.searchParams.get('locale'));
    if (!authorize(request, response, http, authScope, displayLocale)) return;
    let lease: SnapshotLease | undefined;
    const releases: Array<() => void> = [];
    try {
      const locale = queryLocale(url);
      lease = acquire(snapshots);
      const snapshot = lease.value;
      const providers = [...snapshot.tree.keys()].flatMap(owner => {
        const value = ownProviderValue(snapshot, owner);
        return value === undefined ? [] : [{ owner, provider: requireProvider(value) }];
      });
      if (providers.length > 50) throw new PluginTaskError('unavailable', 'providers bound');
      // Admit the entire read before the first await, so HMR cannot mix generations.
      for (const { provider } of providers) releases.push(...admit(provider));
      const rows: ConsolePluginTaskProvider[] = [];
      for (const { owner, provider } of providers) rows.push(projectProvider(snapshot, owner, provider, await callProvider(() => provider.read({ locale })), locale));
      send(response, { generation: snapshot.generation, providers: rows });
    } catch (error) { failure(response, error, displayLocale); }
    finally { releases.reverse().forEach(release => release()); lease?.release(); }
  }, { summary: 'List administrator task providers', tags: ['tasks'], description: 'Read-only task facts. This does not probe or confirm delivery to a platform.' });

  for (const operation of ['create', 'change'] as const) http.route('POST', `${base}/tasks/${operation}`, async (request, response, url, authScope) => {
    let displayLocale = resolveLocale(url.searchParams.get('locale'));
    if (!authorize(request, response, http, authScope, displayLocale)) return;
    let lease: SnapshotLease | undefined;
    const releases: Array<() => void> = [];
    try {
      const input = parseMutation(await readJsonBody(request, { limit: BODY_LIMIT }), operation);
      displayLocale = resolveLocale(input.locale);
      lease = acquire(snapshots);
      const snapshot = lease.value;
      if (input.generation !== snapshot.generation) throw new PluginTaskError('conflict', 'generation');
      const owner = [...snapshot.tree.keys()].find(candidate => candidate === input.owner);
      if (!owner) throw new PluginTaskError('not_found', 'owner');
      const value = ownProviderValue(snapshot, owner);
      if (value === undefined) throw new PluginTaskError('not_found', 'provider');
      const provider = requireProvider(value);
      if (operation === 'create') validateEndpoint(snapshot, input.target!);
      releases.push(...admit(provider));
      const mutation = { requestId: input.requestId, expectedRevision: input.expectedRevision,
        ...(input.locale === undefined ? {} : { locale: input.locale }) };
      // The provider owns durable CAS and idempotency. In particular, never read+404
      // before change: a repeated cancel may only exist in the durable receipt log.
      const result = await callProvider(() => operation === 'create'
        ? provider.create({ ...mutation, target: input.target!, parameters: input.parameters! })
        : provider.change({ ...mutation, id: input.id!, action: input.action!,
          ...(input.parameters === undefined ? {} : { parameters: input.parameters }) }));
      send(response, { generation: snapshot.generation, provider: projectProvider(snapshot, owner, provider, result, input.locale) });
    } catch (error) { failure(response, error, displayLocale); }
    finally { releases.reverse().forEach(release => release()); lease?.release(); }
  }, { summary: `${operation === 'create' ? 'Create' : 'Change'} an administrator task`, tags: ['tasks'],
    description: 'Full-scope, generation-checked persistent task command. Request UUID and revision are reconciled by the provider. No test messages or blind retries.' });
}

function queryLocale(url: URL): Locale {
  if ([...url.searchParams.keys()].some(key => key !== 'locale') || url.searchParams.getAll('locale').length > 1
    || url.searchParams.has('locale') && !isLocale(url.searchParams.get('locale'))) {
    throw new PluginTaskError('invalid_input', 'query');
  }
  return resolveLocale(url.searchParams.get('locale'));
}

function authorize(request: IncomingMessage, response: ServerResponse, http: HttpHost, scope: string, locale: Locale): boolean {
  response.setHeader('cache-control', 'no-store');
  const token = extractBearerToken(request.headers.authorization, null);
  const explicit = http.tokenRegistry.resolve(token);
  if (scope === 'full' && explicit === 'full') return true;
  writeJson(response, explicit === 'demo' ? 403 : 401, { success: false, code: 'forbidden', error: taskMessages(locale, 'auth') });
  return false;
}
function acquire(snapshots?: SnapshotReader): SnapshotLease {
  if (!snapshots) throw new PluginTaskError('unavailable', 'runtime');
  try { return snapshots.acquire(); } catch { throw new PluginTaskError('unavailable', 'runtime'); }
}
function requireProvider(value: unknown): PluginTaskProvider {
  if (!value || typeof value !== 'object' || !['read', 'create', 'change'].every(key => typeof (value as Record<string, unknown>)[key] === 'function')) {
    throw new PluginTaskError('unavailable', 'provider');
  }
  return value as PluginTaskProvider;
}
/** Scope.snapshot flattens inherited bindings; the ancestor remains their authority. */
function ownProviderValue(snapshot: RuntimeSnapshot, owner: PluginId): unknown {
  const value = snapshot.resources.get(owner)?.get(pluginTaskProviderToken.id);
  if (value === undefined) return undefined;
  let parent = snapshot.tree.get(owner)?.parent;
  while (parent) {
    if (snapshot.resources.get(parent)?.get(pluginTaskProviderToken.id) === value) return undefined;
    parent = snapshot.tree.get(parent)?.parent;
  }
  return value;
}
function admit(provider: PluginTaskProvider): Array<() => void> {
  const gates = provider[generationAdmissionSource];
  if (!Array.isArray(gates) || !gates.length || !gates.every(gate => gate instanceof GenerationAdmissionGate)) throw new PluginTaskError('unavailable', 'admission');
  const releases: Array<() => void> = [];
  try {
    for (const gate of new Set(gates)) {
      const release = gate.acquire();
      if (!release) throw new PluginTaskError('conflict', 'inactive generation');
      releases.push(release);
    }
    return releases;
  } catch (error) { releases.reverse().forEach(release => release()); throw error; }
}
function validateEndpoint(snapshot: RuntimeSnapshot, target: DeliveryTarget): void {
  const adapters = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) throw new PluginTaskError('unavailable', 'adapters');
  const id = target.endpoint.id as CapabilityId;
  if (!adapters.list().some(endpoint => endpoint.id === id)) throw new PluginTaskError('not_found', 'endpoint');
  if (adapters.clientAdapter(id) !== target.endpoint.adapter) throw new PluginTaskError('invalid_input', 'adapter mismatch');
  if (!adapters.capabilities(id).outbound) throw new PluginTaskError('unsupported', 'outbound');
}

interface MutationInput {
  generation: number; owner: string; requestId: string; expectedRevision: string; locale?: Locale;
  target?: DeliveryTarget; parameters?: Readonly<Record<string, JsonValue>>; id?: string; action?: PluginTaskAction;
}
function parseMutation(value: unknown, operation: 'create' | 'change'): MutationInput {
  const input = record(value);
  fields(input, operation === 'create'
    ? ['generation', 'owner', 'requestId', 'expectedRevision', 'target', 'parameters', 'locale']
    : ['generation', 'owner', 'requestId', 'expectedRevision', 'id', 'action', 'parameters', 'locale']);
  if (!Number.isSafeInteger(input.generation) || Number(input.generation) < 0) invalid();
  const owner = string(input.owner, 512);
  if (!/^root(?:\/[a-z0-9][a-z0-9-]*)*$/u.test(owner)) invalid();
  const requestId = string(input.requestId, 36);
  if (!UUID.test(requestId)) invalid();
  const expectedRevision = string(input.expectedRevision, 256);
  if (hasControl(expectedRevision)) invalid();
  if (input.locale !== undefined && !isLocale(input.locale)) invalid();
  const common = { generation: input.generation as number, owner, requestId, expectedRevision, locale: input.locale as Locale | undefined };
  if (operation === 'create') return { ...common, target: target(input.target), parameters: jsonRecord(input.parameters) };
  if (!actions.has(input.action as string)) invalid();
  if (input.parameters !== undefined && input.action !== 'update') invalid();
  return { ...common, id: string(input.id, 200), action: input.action as PluginTaskAction,
    ...(input.parameters === undefined ? {} : { parameters: jsonRecord(input.parameters) }) };
}
function target(value: unknown): DeliveryTarget {
  const input = record(value); fields(input, ['endpoint', 'kind', 'id', 'parent', 'threadId']);
  const endpoint = record(input.endpoint); fields(endpoint, ['adapter', 'id']);
  string(endpoint.adapter, 2048); string(endpoint.id, 2048); string(input.id, 2048);
  if (input.parent !== undefined) { const parent = record(input.parent); fields(parent, ['kind', 'id']); string(parent.id, 2048); }
  if (input.threadId !== undefined) string(input.threadId, 2048);
  try { return normalizeDeliveryTarget(input); } catch { return invalid(); }
}

function projectProvider(runtime: RuntimeSnapshot, owner: PluginId, provider: PluginTaskProvider, snapshot: PluginTaskSnapshot, locale: Locale = 'zh-CN'): ConsolePluginTaskProvider {
  try {
    if (!snapshot || !Array.isArray(snapshot.tasks) || snapshot.tasks.length > 500 || !Array.isArray(snapshot.receipts) || snapshot.receipts.length > 500) invalid();
    const revision = string(snapshot.revision, 256);
    if (hasControl(revision)) invalid();
    const tasks: ConsolePluginTask[] = snapshot.tasks.map((task: PluginTask) => {
      if (!task || task.ownership !== 'administrator' || !states.has(task.state) || !Array.isArray(task.actions)
        || task.actions.length > 4 || !task.actions.every((action: unknown) => typeof action === 'string' && actions.has(action))) invalid();
      return { id: string(task.id, 200), ownership: 'administrator', title: string(task.title, 200), target: target(task.target),
        state: task.state, createdAt: timestamp(task.createdAt), parameters: jsonRecord(task.parameters), actions: [...new Set<PluginTaskAction>(task.actions)],
        ...(task.nextRunAt === undefined ? {} : { nextRunAt: timestamp(task.nextRunAt) }),
        ...(task.lastRunAt === undefined ? {} : { lastRunAt: timestamp(task.lastRunAt) }),
        ...(task.timezone === undefined ? {} : { timezone: string(task.timezone, 100) }),
        ...(task.detail === undefined ? {} : { detail: string(task.detail, 4000, true) }),
      };
    });
    const receipts = snapshot.receipts.map((receipt: PluginTaskMutationReceipt) => {
      if (!receipt || !UUID.test(receipt.requestId) || receipt.operation !== 'create' && !actions.has(receipt.operation)) invalid();
      return { requestId: receipt.requestId, taskId: string(receipt.taskId, 200), operation: receipt.operation };
    });
    const display = provider.i18n?.[locale];
    const effects = display?.effects ?? provider.effects;
    if (!Array.isArray(effects) || effects.length > 20) invalid();
    return { owner, packageName: string(runtime.tree.get(owner)?.packageName, 512), title: string(display?.title ?? provider.title, 200), description: string(display?.description ?? provider.description, 2000, true),
      schema: jsonRecord(provider.schema), effects: effects.map(effect => string(effect, 1000)), revision, tasks, receipts };
  } catch { throw new PluginTaskError('unavailable', 'invalid provider snapshot'); }
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid();
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function string(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max) return invalid();
  return value;
}
function hasControl(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159);
}
function jsonRecord(value: unknown): Readonly<Record<string, JsonValue>> {
  const input = record(value);
  let nodes = 0;
  const visit = (item: unknown, depth: number): JsonValue => {
    if (++nodes > 5000 || depth > 12) return invalid();
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') return string(item, BODY_LIMIT, true);
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
    return Object.fromEntries(Object.entries(record(item)).map(([key, child]) => [string(key, 200), visit(child, depth + 1)]));
  };
  const copy = visit(input, 0) as Readonly<Record<string, JsonValue>>;
  if (Buffer.byteLength(JSON.stringify(copy)) > BODY_LIMIT) invalid();
  return copy;
}
function invalid(): never { throw new PluginTaskError('invalid_input', 'input'); }
/** Only the provider's deliberately typed business failures may carry user-facing text. */
class ProviderTaskError extends PluginTaskError {}
async function callProvider<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof PluginTaskError) {
      const message = error.message;
      throw new ProviderTaskError(error.code, message.trim().length > 0 && message.length <= 1000 && !hasControl(message) ? message.trim() : '');
    }
    throw error;
  }
}
function send(response: ServerResponse, data: unknown): void {
  if (Buffer.byteLength(JSON.stringify(data)) > OUTPUT_LIMIT) throw new PluginTaskError('unavailable', 'response bound');
  writeJson(response, 200, { success: true, data });
}
function failure(response: ServerResponse, error: unknown, locale: Locale): void {
  if (error instanceof HttpBodyError) {
    writeJson(response, error.statusCode, { success: false, code: 'invalid_input', error: taskMessages(locale, 'body') });
    return;
  }
  const code = error instanceof PluginTaskError ? error.code : 'internal_error';
  const statuses = { invalid_input: 400, conflict: 409, not_found: 404, unsupported: 400, unavailable: 503, internal_error: 500 };
  writeJson(response, statuses[code], { success: false, code,
    error: error instanceof ProviderTaskError && error.message ? error.message : taskMessages(locale, code) });
}
