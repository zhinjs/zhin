import { afterEach, describe, expect, it } from 'vitest';
import { resolveHttpConfig } from '../../src/plugin-runtime/http-host-installer.js';

const previousToken = process.env.ZHIN_TEST_HTTP_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.ZHIN_TEST_HTTP_TOKEN;
  else process.env.ZHIN_TEST_HTTP_TOKEN = previousToken;
});

describe('Plugin Runtime HTTP Host config', () => {
  it('expands environment references and defaults before creating the Host', async () => {
    process.env.ZHIN_TEST_HTTP_TOKEN = 'secret-from-env';
    await expect(resolveHttpConfig({
      http: {
        token: '${ZHIN_TEST_HTTP_TOKEN}',
        tokens: [{ token: '${MISSING_DEMO_TOKEN:-demo-default}', scope: 'demo' }],
        corsOrigins: ['${MISSING_CONSOLE_ORIGIN:-https://console.example.com}'],
      },
    })).resolves.toMatchObject({
      token: 'secret-from-env',
      tokens: [{ token: 'demo-default', scope: 'demo' }],
      corsOrigins: ['https://console.example.com'],
    });
  });
});
