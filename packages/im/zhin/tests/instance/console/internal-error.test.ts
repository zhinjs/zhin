import type { HttpHandler } from '@zhin.js/host-http';
import { internalErrorResponse } from '../../../src/instance/console/internal-error.js';
import { registerConsoleSystemRoutes } from '../../../src/instance/console/system-routes.js';

const SECRET = 'db password is hunter2';

it('answers an unexpected failure with a stable code and never the error detail', async () => {
  const error = new Error(SECRET);
  const response = internalErrorResponse(500, 'test_failed', error);
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(JSON.parse(text)).toEqual({ success: false, code: 'internal_error', error: 'Internal error' });
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(error.stack!.split('\n')[1]!.trim());
});

it('keeps a thrown error message and stack out of a Console route response', async () => {
  const routes = new Map<string, HttpHandler>();
  const http = { route: (method: string, path: string, handler: HttpHandler) => { routes.set(`${method} ${path}`, handler); return () => undefined; } };
  registerConsoleSystemRoutes({
    http: http as never,
    base: '/api',
    im: { endpoints: { list: () => { throw new Error(SECRET); } } } as never,
  });
  const url = new URL('http://localhost/api/stats');
  const response = await routes.get('GET /api/stats')!(new Request(url), { url, params: {} });
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('at ');
  expect(JSON.parse(text)).toMatchObject({ success: false, code: 'internal_error' });
});
