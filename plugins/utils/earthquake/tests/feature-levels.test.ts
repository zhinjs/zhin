import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeMessage, runCommand, runPluginSetup } from '@zhin.js/testing';
import schema from '../schema.json' with { type: 'json' };
import plugin from '../plugin.ts';
import subscribeCommand from '../commands/地震/订阅/index.ts';
import { jsonResponse, MIRROR_URL, mirrorBody, OFFICIAL_URL, statusResponse, USGS_URL, usgsBody, type QuakeSpec } from './fixtures.js';

const quake = (id: string): QuakeSpec => ({ id, time: Date.now() - 60_000, latitude: 31.9, longitude: 104.46, magnitude: 5.6, location: '四川绵阳市北川县' });

afterEach(() => { vi.unstubAllGlobals(); });

describe('earthquake layered feature switch (ADR 0050 / 0055)', () => {
  it('declares all four levels and keeps every field global', () => {
    expect(schema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'] });
    for (const property of Object.values(schema.properties)) expect(property['x-zhin-config']).toMatchObject({ levels: ['global'] });
  });

  it('does not push to a conversation where earthquake is switched off', async () => {
    const old = { ...quake('CD.old'), time: Date.now() - 30 * 60_000, magnitude: 3.1 };
    let cenc: QuakeSpec[] = [old];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === MIRROR_URL) return jsonResponse(mirrorBody(cenc));
      if (url === USGS_URL) return jsonResponse(usgsBody([]));
      if (url === OFFICIAL_URL) return statusResponse(503);
      throw new TypeError(`unexpected url ${url}`);
    }));
    let enabled = true;
    const checked: unknown[] = [];
    const fake = await runPluginSetup(plugin, { config: {}, feature: { isEnabledFor: target => { checked.push(target); return enabled; } } });
    try {
      const message = createFakeMessage({ sender: { id: 'admin-1', name: 'Admin', roles: ['admin'] } });
      await runCommand(fake, subscribeCommand, { input: message, params: { filters: ['5'] } });
      await fake.clock.advance(2 * 60_000); // baseline tick
      enabled = false;
      cenc = [old, quake('CD.off')];
      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(0);
      expect(checked).toEqual([{ conversation: expect.objectContaining({ id: message.conversation.id }) }]);
      enabled = true;
      cenc = [old, quake('CD.off'), { ...quake('CD.on'), latitude: 20, longitude: 120, location: '台湾花莲县海域' }];
      await fake.clock.advance(2 * 60_000);
      expect(fake.sent).toHaveLength(1);
    } finally { await fake.dispose(); }
  });
});
