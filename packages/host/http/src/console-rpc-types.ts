/**
 * RPC types the runtime Console dispatcher of this package answers (`dispatchRuntimeConsoleRpc`:
 * shell, configuration, plugin management, project files / environment / database, endpoints,
 * schedules, inbox, login assist, workrooms). Used to tell an RPC this Host has but forgot to map
 * (audited `unmapped`) from one it does not have at all (`unknown_rpc`, zhinjs/zhin#1250), and to
 * build the Host's capability list. `console-rpc-types.test.ts` keeps it in step with the
 * dispatchers' `case` labels.
 */
import { CONFIG_RPC, ENDPOINT_RPC, PLUGIN_RPC } from '@zhin.js/console-protocol';

export const RUNTIME_CONSOLE_RPC_TYPES: ReadonlySet<string> = new Set<string>([
  // Shell
  'ping', 'entries:get', 'pages:list',
  // Configuration
  ...Object.values(CONFIG_RPC),
  'workrooms:get', 'workrooms:set',
  // Plugin management (the global switch is refused with a pointer to the gateway)
  ...Object.values(PLUGIN_RPC),
  // Project files / environment / schemas / database / process
  'files:tree', 'files:read', 'files:save',
  'env:list', 'env:get', 'env:save',
  'schema:get', 'schema:get-all',
  'db:info', 'db:tables', 'db:select', 'db:query', 'db:execute',
  'db:schema:describe', 'db:schema:preview', 'db:schema:apply',
  'db:insert', 'db:update', 'db:delete', 'db:drop-table',
  'db:kv:get', 'db:kv:set', 'db:kv:delete', 'db:kv:entries',
  'system:restart',
  // Endpoints
  ...Object.values(ENDPOINT_RPC),
  // Schedules
  'schedule:list', 'cron:list', 'cron:validate', 'cron:add', 'cron:remove', 'cron:pause', 'cron:resume',
  // Requests / notices / inbox
  'request.list', 'request.approve', 'request.reject', 'request.consumed', 'notice.consumed',
  'inbox.requests', 'inbox.notices', 'inbox.messages', 'inbox.recent',
  // Login assist
  'login.list', 'login.submit', 'login.cancel', 'login.flow.list', 'login.flow.get', 'login.relogin', 'login.refresh',
  // Workroom profiles / knowledge
  'workroom.profile.status', 'workroom.profile.bootstrap', 'workroom.profile.pack.publish',
  'workroom.profile.publish', 'workroom.profile.rollback', 'workroom.profile.policy.publish',
  'workroom.knowledge.get', 'workroom.knowledge.publish', 'workroom.knowledge.rollback',
]);

export function isRuntimeConsoleRpcType(type: unknown): type is string {
  return typeof type === 'string' && RUNTIME_CONSOLE_RPC_TYPES.has(type);
}
