import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const secret = 'preflight-test-secret-must-not-appear';

function runPreflight(fail: boolean, malformed = false, telegram = false) {
  const project = mkdtempSync(path.join(tmpdir(), 'zhin-auth-test-'));
  try {
    writeFileSync(path.join(project, '.env'), `PREFLIGHT_TEST_ID=123\nPREFLIGHT_TEST_SECRET=${secret}\n${telegram ? `TELEGRAM_BOT_TOKEN=${secret}\n` : ''}`);
    writeFileSync(path.join(project, 'zhin.config.yml'), malformed
      ? `secret: [${secret}\n`
      : 'plugins:\n  qq:\n    endpoints:\n      - appid: ${PREFLIGHT_TEST_ID}\n        secret: ${PREFLIGHT_TEST_SECRET}\n');
    const stub = path.join(project, 'fetch.mjs');
    writeFileSync(stub, `globalThis.fetch = async (url, options) => {
      if (!['https://bots.qq.com/app/getAppAccessToken', 'https://api.sgroup.qq.com/gateway/bot', 'https://api.telegram.org/bot${secret}/getMe'].includes(url)) throw new Error('Unexpected URL');
      if (options.redirect !== 'error' || !options.signal) throw new Error('Missing request safeguards');
      return { status: ${fail ? 403 : 200}, json: async () => url.endsWith('/getMe') ? { ok: true, result: { is_bot: true } } : (${JSON.stringify(fail
        ? { error: secret, access_token: secret }
        : { access_token: secret, url: 'wss://gateway.example.test' })}) };
    };`);
    const report = path.join(project, 'report.json');
    const result = spawnSync(process.execPath, ['--import', stub,
      path.join(root, 'scripts/check-platform-auth.mjs'), '--project', project, '--report', report],
    { cwd: root, encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr,
      report: malformed ? undefined : JSON.parse(readFileSync(report, 'utf8')) };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

describe('live platform preflight reporting', () => {
  it('reports authentication evidence and missing platforms without credentials', () => {
    const result = runPreflight(false);
    expect(result.status).toBe(0);
    expect(result.output).not.toContain(secret);
    expect(result.report.results).toEqual([
      expect.objectContaining({ platform: 'qq', status: 'passed', gatewayAvailable: true }),
      { platform: 'telegram', status: 'not-configured' },
    ]);
    expect(result.report.kind).toBe('live-auth-only');
    expect(typeof result.report.workingTreeDirty).toBe('boolean');
  });

  it('checks an environment-only Telegram token without printing the token URL', () => {
    const result = runPreflight(false, false, true);
    expect(result.status).toBe(0);
    expect(result.output).not.toContain(secret);
    expect(result.report.results[1]).toMatchObject({ platform: 'telegram', status: 'passed', authHttpStatus: 200 });
  });

  it('fails authentication without exposing a sensitive response body', () => {
    const result = runPreflight(true);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(secret);
    expect(result.report.results[0]).toMatchObject({ status: 'failed', failure: 'authentication-failed' });
  });

  it('does not echo secret configuration text when YAML parsing fails', () => {
    const result = runPreflight(false, true);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(secret);
    expect(result.output).toContain('check project configuration');
  });
});
