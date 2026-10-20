import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { commandFeatureId, explainCommandPermissions, isCommandIndex, type CommandDescriptor } from '@zhin.js/command';
import { extractBearerToken, HttpBodyError, readJsonBody, type HttpHost } from '@zhin.js/host-http';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { normalizeDeliveryTarget, type CapabilityId, type DeliveryTarget, type RuntimeSnapshot, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeJson } from './http-response.js';

const BODY_LIMIT = 32 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;

class ExplanationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Describes command conditions without executing a command, checker, default factory or Endpoint operation. */
export function registerPermissionExplanationRoutes(options: Readonly<{ http: HttpHost; base: string; snapshots?: SnapshotReader }>): void {
  const { http, base, snapshots } = options;
  http.route('GET', `${base}/commands/permissions`, (request, response, url, scope) => {
    if (!authorize(request, response, http, scope)) return;
    let lease: SnapshotLease | undefined;
    try {
      for (const key of url.searchParams.keys()) if (!['page', 'pageSize', 'q'].includes(key) || url.searchParams.getAll(key).length !== 1) invalid();
      const page = integerQuery(url.searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
      const pageSize = integerQuery(url.searchParams.get('pageSize'), 50, 100);
      const q = url.searchParams.get('q') ?? '';
      if (q.length > 200) invalid();
      lease = acquire(snapshots);
      const snapshot = lease.value;
      const commands = commandIndex(snapshot).list().filter(command => !q || `${command.name}\n${command.description ?? ''}\n${command.owner}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
      const offset = (page - 1) * pageSize;
      if (!Number.isSafeInteger(offset)) invalid();
      send(response, { generation: snapshot.generation, page, pageSize, total: commands.length,
        commands: commands.slice(offset, offset + pageSize).map(projectCommand) });
    } catch (error) { failure(response, error); }
    finally { lease?.release(); }
  }, { summary: 'Explain declared command conditions', tags: ['commands'], description: 'Authenticated full-scope, read-only metadata. No command execution or permission checker calls.' });

  http.route('POST', `${base}/commands/permissions/explain`, async (request, response, _url, scope) => {
    if (!authorize(request, response, http, scope)) return;
    let lease: SnapshotLease | undefined;
    try {
      const input = parseInput(await readJsonBody(request, { limit: BODY_LIMIT }));
      lease = acquire(snapshots);
      const snapshot = lease.value;
      if (input.generation !== snapshot.generation) throw new ExplanationError(409, '运行代已变化，请刷新命令列表后重新模拟');
      const command = commandIndex(snapshot).list().find(item => item.id === input.commandId);
      if (!command) throw new ExplanationError(404, '当前运行代中不存在此命令');
      const commandData = projectCommand(command);
      const clientAdapter = input.target ? validateEndpoint(snapshot, input.target) : undefined;
      // Canonical IM-shaped data deliberately carries no metadata, content or lazy Client.
      // resolveCommandSession must remain the authority for defaults and role precedence.
      const source = input.target ? { conversation: input.target, content: '', clientAdapter,
        ...(input.sender ? { sender: input.sender } : {}) }
        : input.sender ? { sender: input.sender } : undefined;
      const host = snapshot.resources.get(snapshot.root)?.get(permissionHostToken.id);
      const explanation = explainCommandPermissions(command, { source,
        rolesKnown: input.sender?.roles !== undefined,
        permissionHost: host instanceof PermissionHost ? 'present' : host === undefined || host === null ? 'missing' : 'unverified' });
      send(response, { generation: snapshot.generation, simulation: true, command: commandData,
        ...(input.target ? { target: input.target } : {}), ...(input.sender ? { sender: input.sender } : {}), ...explanation });
    } catch (error) { failure(response, error); }
    finally { lease?.release(); }
  }, { summary: 'Simulate command builtin conditions', tags: ['commands'], description: 'Hypothetical conditions only, never authorization. Full canonical targets are checked against the current Endpoint catalog without probing connectivity.' });
}

function authorize(request: IncomingMessage, response: ServerResponse, http: HttpHost, scope: string): boolean {
  response.setHeader('cache-control', 'no-store');
  const explicit = http.tokenRegistry.resolve(extractBearerToken(request.headers.authorization, null));
  if (scope === 'full' && explicit === 'full') return true;
  writeJson(response, explicit === 'demo' ? 403 : 401, { success: false, error: '请使用有效的 full scope Bearer Token 读取权限解释' });
  return false;
}
function acquire(snapshots?: SnapshotReader): SnapshotLease {
  if (!snapshots) throw new ExplanationError(503, '命令运行时尚未就绪');
  try { return snapshots.acquire(); } catch { throw new ExplanationError(503, '命令运行时尚未就绪'); }
}
function commandIndex(snapshot: RuntimeSnapshot) {
  const index = snapshot.projections.get(commandFeatureId);
  if (!isCommandIndex(index)) throw new ExplanationError(503, '命令索引尚未就绪');
  return index;
}
function projectCommand(command: CommandDescriptor) {
  // Explicit allowlist: no source paths, default factories, arbitrary params or plugin objects.
  if (!validString(command.id, 8192) || !validString(command.owner, 2048) || !validString(command.name, 4096)
    || command.description !== undefined && !validString(command.description, 8192, true)
    || command.adapter !== undefined && !validString(command.adapter, 2048)
    || (command.permit?.length ?? 0) > 100 || command.permit?.some(rule => !validString(rule, 4096))) {
    throw new ExplanationError(503, '命令声明过大或无效，暂时无法解释');
  }
  return { id: command.id, owner: command.owner, name: command.name,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.adapter === undefined ? {} : { adapter: command.adapter }), permits: [...command.permit ?? []] };
}
function validateEndpoint(snapshot: RuntimeSnapshot, target: DeliveryTarget): string {
  const adapters = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) throw new ExplanationError(503, 'Endpoint 索引尚未就绪');
  const id = target.endpoint.id as CapabilityId;
  if (!adapters.list().some(item => item.id === id)) throw new ExplanationError(404, '当前运行代中不存在此 Endpoint');
  // Public Message/EndpointRuntime identities use the literal adapter, not the
  // plugin owner path. Resolve it from the exact current Endpoint, never a body alias.
  const actual = adapters.clientAdapter(id);
  if (actual !== target.endpoint.adapter) invalid();
  return actual;
}
function parseInput(value: unknown) {
  const input = record(value); fields(input, ['generation', 'commandId', 'target', 'sender']);
  if (!Number.isSafeInteger(input.generation) || (input.generation as number) < 0) invalid();
  if (!validString(input.commandId, 8192)) invalid();
  const target = input.target === undefined ? undefined : parseTarget(input.target);
  let sender: Readonly<{ id: string; roles?: readonly string[] }> | undefined;
  if (input.sender !== undefined) {
    const candidate = record(input.sender); fields(candidate, ['id', 'roles']);
    if (!validString(candidate.id, 2048)) invalid();
    if (candidate.roles !== undefined && (!Array.isArray(candidate.roles) || candidate.roles.length > 100
      || candidate.roles.some(item => !validString(item, 200)))) invalid();
    sender = { id: candidate.id as string, ...(candidate.roles === undefined ? {} : { roles: [...candidate.roles as string[]] }) };
  }
  return { generation: input.generation as number, commandId: input.commandId as string, target, sender };
}
function parseTarget(value: unknown): DeliveryTarget {
  const target = record(value); fields(target, ['endpoint', 'kind', 'id', 'parent', 'threadId']);
  const endpoint = record(target.endpoint); fields(endpoint, ['id', 'adapter']);
  if (!validString(endpoint.id, 8192) || !validString(endpoint.adapter, 2048) || !validString(target.id, 2048)) invalid();
  if (target.parent !== undefined) {
    const parent = record(target.parent); fields(parent, ['kind', 'id']);
    if (!validString(parent.id, 2048)) invalid();
  }
  if (target.threadId !== undefined && !validString(target.threadId, 2048)) invalid();
  try { return normalizeDeliveryTarget(target); } catch { return invalid(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function validString(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
}
function integerQuery(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) return invalid();
  return Number(value);
}
function invalid(): never { throw new ExplanationError(400, '解释参数无效，请提供完整的命令与会话标识'); }
function send(response: ServerResponse, data: unknown): void {
  if (Buffer.byteLength(JSON.stringify(data)) > OUTPUT_LIMIT) throw new ExplanationError(503, '解释结果过大，请缩小查询范围');
  writeJson(response, 200, { success: true, data });
}
function failure(response: ServerResponse, error: unknown): void {
  if (error instanceof ExplanationError) writeJson(response, error.status, { success: false, error: error.message });
  else if (error instanceof HttpBodyError) writeJson(response, error.statusCode, { success: false, error: '请求体无效或过大' });
  else writeJson(response, 500, { success: false, error: '权限解释暂时不可用' });
}
