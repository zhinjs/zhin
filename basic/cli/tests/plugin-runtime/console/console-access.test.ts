import { afterEach, expect, it } from 'vitest';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { registerConsoleEntryRoutes } from '../../../src/plugin-runtime/console/entry-routes.js';
import { registerConsoleHttp } from '../../../src/plugin-runtime/console/host.js';

const hosts: HttpHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); });

type Access = { permissions: readonly string[]; roles: readonly string[]; unrestricted?: boolean };
const pages = [
  { id: 'home', localName: 'home', title: 'Home', route: '/p-home', module: '/home.js', order: 1, hash: 'h1', requiredPermissions: [], requiredRoles: [] },
  { id: 'ambient', localName: 'ambient', title: '群聊插话', route: '/p-ambient', module: '/ambient.js', order: 2, hash: 'h2', requiredPermissions: ['ambient:read'], requiredRoles: [] },
  { id: 'config', localName: 'config', title: 'Config', route: '/p-config', module: '/config.js', order: 3, hash: 'h3', requiredPermissions: [], requiredRoles: ['admin'] },
];
const allowed = (page: (typeof pages)[number], access: Access) => access.unrestricted === true
  || (page.requiredPermissions.every((p) => access.permissions.includes(p)) && page.requiredRoles.every((r) => access.roles.includes(r)));
const consoleRuntime = {
  runView: async (access: Access, operation: (catalog: unknown) => unknown) => operation({
    pages: () => pages.filter((page) => allowed(page, access)),
    topology: () => ({ generation: 1, pages: pages.filter((page) => allowed(page, access)), navigation: [], resolve: () => ({ status: 'missing' }) }),
  }),
} as unknown as ConsoleRuntime;

async function start(tokens = true) {
  const http = createHttpHost({
    host: '127.0.0.1', port: 0,
    ...(tokens ? {
      token: 'admin-secret',
      tokens: [{ token: 'alice-secret', scope: 'demo' as const, permissions: ['ambient:read'] }],
    } : {}),
  });
  hosts.push(http);
  registerConsoleEntryRoutes({ http, consoleRuntime });
  registerConsoleHttp({ http, console: consoleRuntime, clientOutDir: '/tmp/zhin-access-client', projectRoot: '/tmp/zhin-access' });
  const { port } = await http.listen();
  return async (path: string, token?: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() as Record<string, unknown> };
  };
}
const ids = (body: Record<string, unknown>, key: 'entries' | 'pages') => (body[key] as { id: string }[]).map((item) => item.id);

it('filters /entries by the caller token: public, scoped user and operator', async () => {
  const get = await start();
  const anonymous = await get('/entries');
  expect(ids(anonymous.body, 'entries')).toEqual(['home']);
  expect(anonymous.cache).toBe('no-store');
  expect(ids((await get('/entries', 'alice-secret')).body, 'entries')).toEqual(['home', 'ambient']);
  expect(ids((await get('/entries', 'admin-secret')).body, 'entries')).toEqual(['home', 'ambient', 'config']);
  expect(ids((await get('/entries', 'wrong')).body, 'entries')).toEqual(['home']);
});

it('filters the page list and topology the same way', async () => {
  const get = await start();
  expect((await get('/console/api/pages', 'alice-secret')).body.pages).toHaveLength(2);
  expect((await get('/console/api/topology', 'alice-secret')).body.pages).toHaveLength(2);
  expect((await get('/console/api/topology')).body.pages).toHaveLength(1);
});

it('keeps a Host without tokens fully open, as before', async () => {
  const get = await start(false);
  expect(ids((await get('/entries')).body, 'entries')).toEqual(['home', 'ambient', 'config']);
});
