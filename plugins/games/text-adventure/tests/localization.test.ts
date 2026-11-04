import { channelKey, createMemoryGameServices, plainTextFromSendContent, type GamePlayer } from '@zhin.js/game-kit';
import { handleChoice, startAdventure } from '../src/game-flow.js';
import { getAdvHelp } from '../src/adv-command.js';
import { createServices } from '../src/session-service.js';
import { SCENES, sceneCatalog } from '../src/story-scenes.js';
import { sceneNarrative, visibleChoices, type GameState } from '../src/story.js';
import { ITEM_IDS } from '../src/story-items.js';

function message(locale: 'zh-CN' | 'en'): GamePlayer {
  return { target: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' }, conversation: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' },
locale,
sender: { id: 'alice', name: 'Alice' },
content: '',
$reply: async () => 'mid',
formatCommand: (path) => path === 'adv' ? '!games adventure' : undefined };
}

it('translates every scene and choice without changing its requirements or payloads', () => {
  const english = sceneCatalog('en');
  expect(Object.keys(english)).toEqual(Object.keys(SCENES));
  for (const inventory of [[], ITEM_IDS]) {
    const state: GameState = {
      sceneId: 'start', hp: 100, inventory, endingId: '',
      flags: Object.fromEntries(['spirit_met', 'saw_map', 'knows_sequence', 'whisper_lore', 'healed', 'rested', 'read_archive', 'forged_blade', 'amulet_upgraded', 'moon_blessed'].map((key) => [key, !!inventory.length])),
    };
    for (const [id, chineseScene] of Object.entries(SCENES)) {
      const scene = english[id]!;
      expect(scene.terminal).toBe(chineseScene.terminal);
      expect(visibleChoices(scene, state).map(({ id, style }) => ({ id, style })))
        .toEqual(visibleChoices(chineseScene, state).map(({ id, style }) => ({ id, style })));
      expect(sceneNarrative(scene, state, 'en')).not.toMatch(/[\u4e00-\u9fff]/);
      expect(scene.choices.map(({ label }) => label).join('\n')).not.toMatch(/[\u4e00-\u9fff]/);
    }
  }
});

it('keeps an active adventure language and captures the new language on restart', async () => {
  const services = createMemoryGameServices(['adv_sessions', 'adv_profiles'], createServices);
  expect(plainTextFromSendContent(await startAdventure(services, message('en')) ?? '')).toContain('Entrance to the Ruins');
  const session = (await services.sessions.getActiveForUser(channelKey({ target: { endpoint: { adapter: 'test', id: 'default' }, kind: 'group', id: 'g1' } }), 'alice'))!;
  expect(session.locale).toBe('en');
  const result = await handleChoice(services, message('zh-CN'), session.id, 'leave');
  expect(plainTextFromSendContent(result ?? '')).toContain("A Coward's Return");
  expect(plainTextFromSendContent(result ?? '')).not.toMatch(/[\u4e00-\u9fff]/);
  const restart = await handleChoice(services, message('zh-CN'), session.id, 'restart');
  expect(plainTextFromSendContent(restart ?? '')).toContain('秘境入口');
  expect((await services.sessions.getById(session.id))?.locale).toBe('zh-CN');
});

it('shows only verified command invocations in adventure help', () => {
  expect(getAdvHelp(message('en'))).toContain('!games adventure map');
  expect(getAdvHelp({ locale: 'en' })).not.toContain('adv ');
});
