import { describe, expect, it } from 'vitest';
import { generateEndpointsConfigYaml, getAdapterDependencies, getAdapterSetupNotes } from '../src/adapter.js';
import type { AdapterSetupResult } from '../src/adapter.js';

describe('adapter setup notes', () => {
  it('returns telegram webhook guidance when webhook mode is configured', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-telegram'],
      plugins: ['@zhin.js/adapter-telegram'],
      endpoints: [{
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
      endpoints: [{
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

describe('generateEndpointsConfigYaml', () => {
  it('emits endpoints: [] when no bot entries (Sandbox-only)', () => {
    const yaml = generateEndpointsConfigYaml({
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      envVars: {},
      endpoints: [],
    });
    expect(yaml).toMatch(/endpoints:\s*\[\]/);
    expect(yaml).not.toContain('context:');
  });

  it('renders nested webhook object as YAML', () => {
    const yaml = generateEndpointsConfigYaml({
      packages: [],
      plugins: [],
      envVars: {},
      endpoints: [{
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

describe('getAdapterDependencies', () => {
  it('uses latest for unversioned Zhin adapters', () => {
    const deps = getAdapterDependencies({
      packages: ['@zhin.js/adapter-sandbox', '@zhin.js/adapter-telegram', '@icqqjs/icqq@latest'],
      plugins: [],
      endpoints: [],
      envVars: {},
    });

    expect(deps['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(deps['@zhin.js/adapter-telegram']).toBe('latest');
    expect(deps['@icqqjs/icqq']).toBe('latest');
  });
});
