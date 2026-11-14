import type { HttpHandler } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import { internalErrorResponse } from '../../../src/instance/console/internal-error.js';
import { registerConsoleSystemRoutes } from '../../../src/instance/console/system-routes.js';

const SECRET = 'db password is hunter2';

it('answers an unexpected failure with a stable code and never the error detail', async () => {
  const error = new Error(SECRET);
  const response = internalErrorResponse(500, 'test_failed', error);
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(JSON.parse(text)).toEqual({ success: false, code: 'internal_error', error: 'Internal error', errorId: expect.stringMatching(/^err_[0-9a-f]{12}$/) });
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(error.stack!.split('\n')[1]!.trim());
});

it('logs the unexpected failure under the same correlation id it returns (#1250)', async () => {
  const lines: string[] = [];
  const transport = { write: (line: string) => { lines.push(line); } };
  const consoleLogger = getLogger('console');
  consoleLogger.addTransport(transport);
  try {
    const body = JSON.parse(await internalErrorResponse(500, 'test_failed', new Error(SECRET)).text()) as { errorId: string };
    expect(lines.some(line => line.includes(`errorId: ${body.errorId}`) && line.includes(SECRET))).toBe(true);
    const second = JSON.parse(await internalErrorResponse(500, 'test_failed', new Error('x')).text()) as { errorId: string };
    expect(second.errorId).not.toBe(body.errorId);
  } finally {
    consoleLogger.removeTransport(transport);
  }
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
