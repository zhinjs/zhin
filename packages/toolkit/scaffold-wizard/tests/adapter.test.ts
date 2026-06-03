import { describe, expect, it } from 'vitest';
import { generateBotsConfigYaml, getAdapterSetupNotes } from '../src/adapter.js';
import type { AdapterSetupResult } from '../src/adapter.js';

describe('adapter setup notes', () => {
  it('returns telegram webhook guidance when webhook mode is configured', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-telegram'],
      plugins: ['@zhin.js/adapter-telegram'],
      bots: [{
        context: 'telegram',
        name: 'tg',
        token: '${TELEGRAM_TOKEN}',
        polling: false,
        webhook: { domain: 'https://bot.example.com', path: '/telegram-webhook', port: 8443 },
      }],
      envVars: { TELEGRAM_TOKEN: 'secret' },
    };

    const notes = getAdapterSetupNotes(result);
    expect(notes.some(n => n.includes('HTTPS'))).toBe(true);
  });

  it('returns github app and webhook notes', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-github'],
      plugins: ['@zhin.js/adapter-github'],
      bots: [{
        context: 'github',
        name: 'gh',
        app_id: '${GITHUB_APP_ID}',
        private_key: './data/github-app.pem',
        webhook_secret: '${GITHUB_WEBHOOK_SECRET}',
        webhook_path: '/pub/github/webhook',
      }],
      envVars: {},
      requiresDatabase: true,
    };

    const notes = getAdapterSetupNotes(result);
    expect(notes.some(n => n.includes('/pub/github/webhook'))).toBe(true);
    expect(notes.some(n => n.includes('SQLite'))).toBe(true);
  });
});

describe('generateBotsConfigYaml', () => {
  it('renders nested webhook object as YAML', () => {
    const yaml = generateBotsConfigYaml({
      packages: [],
      plugins: [],
      envVars: {},
      bots: [{
        context: 'telegram',
        name: 'tg',
        polling: false,
        webhook: {
          domain: 'https://bot.example.com',
          path: '/telegram-webhook',
          port: 8443,
        },
      }],
    });

    expect(yaml).toContain('webhook:');
    expect(yaml).toContain('domain: https://bot.example.com');
    expect(yaml).toContain('path: /telegram-webhook');
    expect(yaml).toContain('port: 8443');
  });
});
