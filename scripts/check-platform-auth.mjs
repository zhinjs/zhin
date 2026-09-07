#!/usr/bin/env node
/** Live, read-only platform preflight. Never sends messages or changes webhook registration. */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, report: { type: 'string' },
  } });
  if (!values.project) throw new Error('Usage: node scripts/check-platform-auth.mjs --project <directory> [--report <new-file>]');
  const project = path.resolve(values.project);
  const envFile = path.join(project, '.env');
  const env = { ...(fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {}), ...process.env };
  const config = parse(fs.readFileSync(path.join(project, 'zhin.config.yml'), 'utf8'));
  const resolve = (value) => typeof value === 'string'
    ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => env[key] ?? '') : value;
  const report = { kind: 'live-auth-only', time: new Date().toISOString(), node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    results: [], limitations: ['No message delivery, WebSocket connection, webhook mutation, recovery or soak testing.'] };

  async function request(url, options) {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    return { status: response.status, body };
  }
  for (const platform of ['qq', 'telegram']) {
    const plugin = config.plugins?.[platform];
    const token = env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN;
    const endpoints = plugin?.endpoints?.length ? plugin.endpoints
      : platform === 'telegram' && token ? [{ token }] : [];
    if (!endpoints.length) report.results.push({ platform, status: 'not-configured' });
    for (const [index, endpoint] of endpoints.entries()) {
      const entry = { ...plugin, ...endpoint };
      const result = { platform, endpointIndex: index, status: 'failed' };
      try {
        if (platform === 'qq') {
          const appId = resolve(entry.appid);
          const clientSecret = resolve(entry.secret);
          if (!appId || !clientSecret) throw new Error('missing-credentials');
          const auth = await request('https://bots.qq.com/app/getAppAccessToken', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId, clientSecret }),
          });
          result.authHttpStatus = auth.status;
          if (auth.status !== 200 || !auth.body?.access_token) throw new Error('authentication-failed');
          const gateway = await request(`https://${entry.sandbox ? 'sandbox.' : ''}api.sgroup.qq.com/gateway/bot`, {
            headers: { Authorization: `QQBot ${auth.body.access_token}` },
          });
          result.gatewayHttpStatus = gateway.status;
          result.gatewayAvailable = typeof gateway.body?.url === 'string' && gateway.body.url.startsWith('wss://');
          if (gateway.status !== 200 || !result.gatewayAvailable) throw new Error('gateway-unavailable');
        } else {
          const token = resolve(entry.token) || env.TELEGRAM_TOKEN || env.TELEGRAM_BOT_TOKEN;
          if (!token) throw new Error('missing-credentials');
          const auth = await request(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST' });
          result.authHttpStatus = auth.status;
          if (auth.status !== 200 || auth.body?.ok !== true || auth.body?.result?.is_bot !== true) {
            throw new Error('authentication-failed');
          }
        }
        result.status = 'passed';
      } catch (error) {
        // Never log remote response bodies, URLs (Telegram tokens), credentials or raw fetch errors.
        const known = ['missing-credentials', 'authentication-failed', 'gateway-unavailable'];
        result.failure = known.includes(error?.message) ? error.message : 'request-failed';
      }
      report.results.push(result);
    }
  }
  const output = JSON.stringify(report, null, 2);
  if (values.report) fs.writeFileSync(values.report, output + '\n', { flag: 'wx', mode: 0o600 });
  console.log(output);
  if (!report.results.some((result) => result.status === 'passed')
    || report.results.some((result) => result.status === 'failed')) process.exitCode = 1;
}

main().catch(() => {
  console.error("Platform auth preflight failed: check project configuration and report path.");
  process.exitCode = 1;
});
