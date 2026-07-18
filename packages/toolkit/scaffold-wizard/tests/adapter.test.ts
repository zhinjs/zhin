import { describe, expect, it } from 'vitest';
import {
  collectAdapterPluginConfigs,
  collectAdapterPluginManifest,
  getAdapterDependencies,
  getAdapterSetupNotes,
  type AdapterSetupResult,
} from '../src/adapter.js';

describe('adapter setup notes', () => {
  it('returns telegram webhook guidance when webhook mode is configured', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-telegram'],
      plugins: ['@zhin.js/adapter-telegram'],
      instances: [{
        package: '@zhin.js/adapter-telegram',
        instanceKey: 'telegram',
        config: {
          name: 'tg',
          token: '${TELEGRAM_TOKEN}',
          polling: false,
          webhook: { domain: 'https://bot.example.com', path: '/telegram/webhook' },
        },
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
      instances: [{
        package: '@zhin.js/adapter-github',
        instanceKey: 'github',
        config: {
          name: 'gh',
          app_id: '${GITHUB_APP_ID}',
          private_key: './data/github-app.pem',
          webhook_secret: '${GITHUB_WEBHOOK_SECRET}',
          webhook_path: '/github/webhook',
        },
      }],
      envVars: {},
      requiresDatabase: true,
    };

    const notes = getAdapterSetupNotes(result);
    expect(notes.some(n => n.includes('/github/webhook'))).toBe(true);
    expect(notes.some(n => n.includes('SQLite'))).toBe(true);
  });
});

describe('collectAdapterPluginConfigs', () => {
  it('maps instances to plugins.<instanceKey> config blocks', () => {
    const plugins = collectAdapterPluginConfigs({
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      instances: [{
        package: '@zhin.js/adapter-sandbox',
        instanceKey: 'sandbox',
        config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
      }],
      envVars: {},
    });

    expect(plugins).toEqual({
      sandbox: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
    });
  });
});

describe('collectAdapterPluginManifest', () => {
  it('maps instances to package.json zhin.plugins entries', () => {
    const manifest = collectAdapterPluginManifest({
      packages: [],
      plugins: [],
      instances: [
        { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', config: {} },
        { package: '@zhin.js/adapter-telegram', instanceKey: 'telegram', config: {} },
      ],
      envVars: {},
    });

    expect(manifest).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
      { package: '@zhin.js/adapter-telegram', instanceKey: 'telegram' },
    ]);
  });
});

describe('getAdapterDependencies', () => {
  it('uses latest for @zhin.js adapters in user projects', () => {
    const deps = getAdapterDependencies({
      packages: ['@zhin.js/adapter-sandbox', '@zhin.js/adapter-telegram', '@icqqjs/icqq@latest'],
      plugins: [],
      instances: [],
      envVars: {},
    });

    expect(deps['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(deps['@zhin.js/adapter-telegram']).toBe('latest');
    expect(deps['@icqqjs/icqq']).toBe('latest');
  });
});
