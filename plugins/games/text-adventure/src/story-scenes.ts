import { createMessages, type Locale } from 'zhin.js/i18n';
import type { GameState, Scene } from './story-types.js';

const T = (lines: string[]) => lines.join('\n');

/** 非终局场景 28 个 + 终局 12 个 */
function createScenes(locale: Locale): Record<string, Scene> {
  return {
  start: {
    id: 'start',
    text: (s) => {
      const lines = [
        text(locale, 'story1'),
        '',
        text(locale, 'story2'),
      ];
      if (s.inventory.includes('torch')) lines.push('', text(locale, 'story3'));
      if (s.flags.spirit_met) lines.push('', text(locale, 'story4'));
      if (s.flags.saw_map) lines.push('', text(locale, 'story5'));
      return lines.join('\n');
    },
    choices: [
      { id: 'push_door', label: text(locale, 'story6'), style: 'primary' },
      { id: 'search_rubble', label: text(locale, 'story7') },
      { id: 'climb_tower', label: text(locale, 'story8') },
      { id: 'vine_path', label: text(locale, 'story9'), requires: (s) => s.flags.spirit_met },
      { id: 'leave', label: text(locale, 'story10'), style: 'danger' },
    ],
  },

  rubble: {
    id: 'rubble',
    text: T([
      text(locale, 'story11'),
      text(locale, 'story12'),
    ]),
    choices: [
      { id: 'take_torch', label: text(locale, 'story13'), requires: (s) => !s.inventory.includes('torch') },
      { id: 'take_blade', label: text(locale, 'story14'), requires: (s) => !s.inventory.includes('rusted_blade') },
      { id: 'back_entrance', label: text(locale, 'story15') },
    ],
  },

  watchtower: {
    id: 'watchtower',
    text: (s) => T([
      text(locale, 'story16'),
      '',
      s.flags.saw_map
        ? text(locale, 'story17')
        : text(locale, 'story18'),
      text(locale, 'story19'),
    ]),
    choices: [
      { id: 'survey_map', label: text(locale, 'story20'), requires: (s) => !s.flags.saw_map },
      { id: 'take_chart_fragment', label: text(locale, 'story21'), requires: (s) => !s.inventory.includes('star_chart') },
      { id: 'enter_observatory', label: text(locale, 'story22'), requires: (s) => s.flags.saw_map },
      { id: 'descend_tower', label: text(locale, 'story23') },
    ],
  },

  vine_path: {
    id: 'vine_path',
    text: T([text(locale, 'story24'), '', text(locale, 'story25')]),
    choices: [
      { id: 'enter_garden', label: text(locale, 'story26') },
      { id: 'back_entrance', label: text(locale, 'story15') },
    ],
  },

  corridor: {
    id: 'corridor',
    text: (s) => {
      const lit = s.inventory.includes('torch');
      const lines = [
        lit ? text(locale, 'story27') : text(locale, 'story28'),
        text(locale, 'story29'),
      ];
      if (s.flags.knows_sequence) lines.push('', text(locale, 'story30'));
      return lines.join('\n');
    },
    choices: [
      { id: 'go_blue', label: text(locale, 'story31') },
      { id: 'go_stairs', label: text(locale, 'story32') },
      { id: 'go_flooded', label: text(locale, 'story33') },
      { id: 'study_mural', label: text(locale, 'story34'), requires: (s) => s.inventory.includes('torch') },
      { id: 'enter_bell_tower', label: text(locale, 'story35'), requires: (s) => s.flags.spirit_met },
      { id: 'go_back', label: text(locale, 'story36') },
    ],
  },

  mural_room: {
    id: 'mural_room',
    text: T([
      text(locale, 'story37'),
      '',
      text(locale, 'story38'),
      text(locale, 'story39'),
    ]),
    choices: [
      { id: 'memorize', label: text(locale, 'story40') },
      { id: 'enter_whisper', label: text(locale, 'story41'), requires: (s) => s.flags.knows_sequence },
      { id: 'back_corridor', label: text(locale, 'story42') },
    ],
  },

  whisper_gallery: {
    id: 'whisper_gallery',
    text: T([
      text(locale, 'story43'),
      '',
      text(locale, 'story44'),
      text(locale, 'story45'),
    ]),
    choices: [
      { id: 'listen_deep', label: text(locale, 'story46'), requires: (s) => !s.flags.whisper_lore },
      { id: 'back_mural', label: text(locale, 'story47') },
    ],
  },

  spring: {
    id: 'spring',
    text: (s) => T([
      text(locale, 'story48'),
      '',
      s.flags.spirit_met ? text(locale, 'story49') : text(locale, 'story50'),
      !s.flags.healed ? text(locale, 'story51') : text(locale, 'story52'),
    ]),
    choices: [
      { id: 'drink', label: text(locale, 'story53'), requires: (s) => !s.flags.healed },
      { id: 'take_gem', label: text(locale, 'story54'), requires: (s) => !s.inventory.includes('gem') },
      { id: 'talk_spirit', label: text(locale, 'story55'), requires: (s) => !s.flags.spirit_met },
      { id: 'offer_gem', label: text(locale, 'story56'), requires: (s) => s.inventory.includes('gem') && !s.inventory.includes('amulet') },
      { id: 'leave_spring', label: text(locale, 'story57') },
    ],
  },

  flooded_hall: {
    id: 'flooded_hall',
    text: (s) => T([
      text(locale, 'story58'),
      '',
      text(locale, 'story59'),
      s.inventory.includes('elf_feather') ? text(locale, 'story60') : text(locale, 'story61'),
    ]),
    choices: [
      { id: 'wade_market', label: text(locale, 'story62') },
      { id: 'use_feather_wade', label: text(locale, 'story63'), requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'drink_elixir_warm', label: text(locale, 'story64'), requires: (s) => s.inventory.includes('elixir') },
      { id: 'back_corridor', label: text(locale, 'story42') },
    ],
  },

  market_ruins: {
    id: 'market_ruins',
    text: T([
      text(locale, 'story65'),
      '',
      text(locale, 'story66'),
    ]),
    choices: [
      { id: 'buy_mask_coin', label: text(locale, 'story67'), requires: (s) => s.inventory.includes('silver_coin') && !s.inventory.includes('masquerade_mask') },
      { id: 'trade_gem_coin', label: text(locale, 'story68'), requires: (s) => s.inventory.includes('gem') },
      { id: 'go_bridge', label: text(locale, 'story69') },
      { id: 'leave_market', label: text(locale, 'story70') },
    ],
  },

  garden: {
    id: 'garden',
    text: (s) => T([
      text(locale, 'story71'),
      '',
      text(locale, 'story72'),
      s.inventory.includes('herb') ? text(locale, 'story73') : text(locale, 'story74'),
    ]),
    choices: [
      { id: 'pick_herb', label: text(locale, 'story75'), requires: (s) => !s.inventory.includes('herb') },
      { id: 'rest_tree', label: text(locale, 'story76'), requires: (s) => !s.flags.rested },
      { id: 'enter_greenhouse', label: text(locale, 'story77') },
      { id: 'open_iron_door', label: text(locale, 'story78'), requires: (s) => s.inventory.includes('key') },
      { id: 'stay_forever', label: text(locale, 'story79'), requires: (s) => s.flags.rested && s.flags.spirit_met },
      { id: 'back_corridor', label: text(locale, 'story42') },
    ],
  },

  greenhouse: {
    id: 'greenhouse',
    text: T([
      text(locale, 'story80'),
      '',
      text(locale, 'story81'),
    ]),
    choices: [
      { id: 'brew_elixir', label: text(locale, 'story82'), requires: (s) => s.inventory.includes('herb') && !s.inventory.includes('elixir') },
      { id: 'back_garden', label: text(locale, 'story83') },
    ],
  },

  library: {
    id: 'library',
    text: (s) => T([
      text(locale, 'story84'),
      '',
      text(locale, 'story85'),
      s.flags.read_archive ? text(locale, 'story86') : text(locale, 'story87'),
    ]),
    choices: [
      { id: 'take_scroll', label: text(locale, 'story88'), requires: (s) => !s.inventory.includes('scroll') },
      { id: 'take_key', label: text(locale, 'story89'), requires: (s) => !s.inventory.includes('key') },
      { id: 'read_archive', label: text(locale, 'story90'), requires: (s) => !s.flags.read_archive },
      { id: 'enter_forge', label: text(locale, 'story91'), requires: (s) => s.inventory.includes('scroll') },
      { id: 'back_garden', label: text(locale, 'story83') },
    ],
  },

  ember_forge: {
    id: 'ember_forge',
    text: (s) => T([
      text(locale, 'story92'),
      '',
      text(locale, 'story93'),
      s.flags.forged_blade ? text(locale, 'story94') : text(locale, 'story95'),
    ]),
    choices: [
      { id: 'forge_blade', label: text(locale, 'story96'), requires: (s) => s.inventory.includes('rusted_blade') && !s.flags.forged_blade },
      { id: 'upgrade_amulet', label: text(locale, 'story97'), requires: (s) => s.inventory.includes('amulet') && s.inventory.includes('moon_shard') && !s.flags.amulet_upgraded },
      { id: 'back_library', label: text(locale, 'story98') },
    ],
  },

  bell_tower: {
    id: 'bell_tower',
    text: T([
      text(locale, 'story99'),
      '',
      text(locale, 'story100'),
    ]),
    choices: [
      { id: 'ring_bell', label: text(locale, 'story101'), requires: (s) => !s.inventory.includes('spirit_bell') },
      { id: 'back_corridor', label: text(locale, 'story42') },
    ],
  },

  depths: {
    id: 'depths',
    text: T([
      text(locale, 'story102'),
      '',
      text(locale, 'story103'),
    ]),
    choices: [
      { id: 'fight', label: text(locale, 'story104'), style: 'danger' },
      { id: 'fight_blade', label: text(locale, 'story105'), requires: (s) => s.flags.forged_blade },
      { id: 'use_torch', label: text(locale, 'story106'), requires: (s) => s.inventory.includes('torch') },
      { id: 'use_herb', label: text(locale, 'story107'), requires: (s) => s.inventory.includes('herb') },
      { id: 'flee', label: text(locale, 'story108') },
    ],
  },

  crypt_entry: {
    id: 'crypt_entry',
    text: T([
      text(locale, 'story109'),
      '',
      text(locale, 'story110'),
    ]),
    choices: [
      { id: 'go_vault', label: text(locale, 'story111') },
      { id: 'go_catacombs', label: text(locale, 'story112') },
      { id: 'go_spider', label: text(locale, 'story113') },
      { id: 'go_sealed', label: text(locale, 'story114'), requires: (s) => s.inventory.includes('spirit_bell') && s.inventory.includes('compass') },
      { id: 'back_corridor', label: text(locale, 'story42') },
    ],
  },

  spider_nest: {
    id: 'spider_nest',
    text: T([
      text(locale, 'story115'),
      '',
      text(locale, 'story116'),
    ]),
    choices: [
      { id: 'cut_web_blade', label: text(locale, 'story117'), requires: (s) => s.flags.forged_blade },
      { id: 'burn_web', label: text(locale, 'story118'), requires: (s) => s.inventory.includes('torch') },
      { id: 'flee_spider', label: text(locale, 'story119'), style: 'danger' },
    ],
  },

  shadow_maze: {
    id: 'shadow_maze',
    text: T([
      text(locale, 'story120'),
      '',
      text(locale, 'story121'),
    ]),
    choices: [
      { id: 'navigate_compass', label: text(locale, 'story122'), requires: (s) => s.inventory.includes('compass') },
      { id: 'wander_maze', label: text(locale, 'story123'), style: 'danger' },
      { id: 'back_spider', label: text(locale, 'story124') },
    ],
  },

  catacombs: {
    id: 'catacombs',
    text: T([
      text(locale, 'story125'),
      '',
      text(locale, 'story126'),
      text(locale, 'story127'),
    ]),
    choices: [
      { id: 'read_scroll', label: text(locale, 'story128'), requires: (s) => s.inventory.includes('scroll') },
      { id: 'dash_trap', label: text(locale, 'story129'), style: 'danger' },
      { id: 'enter_prison', label: text(locale, 'story130') },
      { id: 'take_key_skeleton', label: text(locale, 'story131'), requires: (s) => !s.inventory.includes('key') },
      { id: 'back_crypt', label: text(locale, 'story132') },
    ],
  },

  prison_cell: {
    id: 'prison_cell',
    text: T([
      text(locale, 'story133'),
      '',
      text(locale, 'story134'),
      text(locale, 'story135'),
    ]),
    choices: [
      { id: 'take_coin', label: text(locale, 'story136'), requires: (s) => !s.inventory.includes('silver_coin') },
      { id: 'free_ghost', label: text(locale, 'story137'), requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'back_catacombs', label: text(locale, 'story138') },
    ],
  },

  ossuary: {
    id: 'ossuary',
    text: T([
      text(locale, 'story139'),
      '',
      text(locale, 'story140'),
    ]),
    choices: [
      { id: 'answer_greed', label: text(locale, 'story141') },
      { id: 'answer_flood', label: text(locale, 'story142') },
      { id: 'answer_star', label: text(locale, 'story143'), style: 'primary' },
      { id: 'back_catacombs', label: text(locale, 'story138') },
    ],
  },

  ghost_bridge: {
    id: 'ghost_bridge',
    text: T([
      text(locale, 'story144'),
      '',
      text(locale, 'story145'),
    ]),
    choices: [
      { id: 'pay_coin', label: text(locale, 'story146'), requires: (s) => s.inventory.includes('silver_coin') },
      { id: 'cross_feather', label: text(locale, 'story147'), requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'back_market', label: text(locale, 'story148') },
    ],
  },

  crystal_cave: {
    id: 'crystal_cave',
    text: T([
      text(locale, 'story149'),
      '',
      text(locale, 'story150'),
    ]),
    choices: [
      { id: 'take_moon_shard', label: text(locale, 'story151'), requires: (s) => !s.inventory.includes('moon_shard') },
      { id: 'take_feather', label: text(locale, 'story152'), requires: (s) => !s.inventory.includes('elf_feather') },
      { id: 'enter_moon_pool', label: text(locale, 'story153') },
      { id: 'back_bridge', label: text(locale, 'story154') },
    ],
  },

  moon_pool: {
    id: 'moon_pool',
    text: (s) => T([
      text(locale, 'story155'),
      '',
      text(locale, 'story156'),
      s.flags.moon_blessed ? text(locale, 'story157') : text(locale, 'story158'),
    ]),
    choices: [
      { id: 'align_chart', label: text(locale, 'story159'), requires: (s) => s.inventory.includes('star_chart') && !s.flags.moon_blessed },
      { id: 'dive_shrine', label: text(locale, 'story160'), requires: (s) => s.flags.moon_blessed },
      { id: 'back_crystal', label: text(locale, 'story161') },
    ],
  },

  sunken_shrine: {
    id: 'sunken_shrine',
    text: T([
      text(locale, 'story162'),
      '',
      text(locale, 'story163'),
    ]),
    choices: [
      { id: 'ritual_star_keeper', label: text(locale, 'story164'), requires: (s) => s.inventory.includes('moon_shard') && s.inventory.includes('star_chart') && s.flags.spirit_met },
      { id: 'back_moon_pool', label: text(locale, 'story165') },
    ],
  },

  observatory: {
    id: 'observatory',
    text: T([
      text(locale, 'story166'),
      '',
      text(locale, 'story167'),
    ]),
    choices: [
      { id: 'craft_compass', label: text(locale, 'story168'), requires: (s) => !s.inventory.includes('compass') },
      { id: 'back_tower', label: text(locale, 'story23') },
    ],
  },

  sealed_gates: {
    id: 'sealed_gates',
    text: T([
      text(locale, 'story169'),
      '',
      text(locale, 'story170'),
    ]),
    choices: [
      { id: 'open_gates', label: text(locale, 'story171'), requires: (s) => s.inventory.includes('spirit_bell') && s.inventory.includes('compass') && s.inventory.includes('key') },
      { id: 'back_crypt', label: text(locale, 'story132') },
    ],
  },

  vault: {
    id: 'vault',
    text: (s) => T([
      text(locale, 'story172'),
      '',
      text(locale, 'story173'),
      s.flags.knows_sequence ? text(locale, 'story174') : text(locale, 'story175'),
    ]),
    choices: [
      { id: 'seq_light_shadow_door', label: text(locale, 'story176'), style: 'primary' },
      { id: 'seq_door_light_shadow', label: text(locale, 'story177') },
      { id: 'seq_shadow_door_light', label: text(locale, 'story178') },
      { id: 'back_crypt', label: text(locale, 'story132') },
    ],
  },

  vault_open: {
    id: 'vault_open',
    text: (s) => T([
      text(locale, 'story179'),
      '',
      s.flags.amulet_upgraded ? text(locale, 'story180') : text(locale, 'story181'),
    ]),
    choices: [
      { id: 'descend_throne', label: text(locale, 'story182') },
      { id: 'take_treasure_now', label: text(locale, 'story183') },
      { id: 'back_crypt', label: text(locale, 'story132') },
    ],
  },

  throne_room: {
    id: 'throne_room',
    text: (s) => {
      const ready = s.flags.whisper_lore && s.flags.amulet_upgraded && s.flags.spirit_met;
      return T([
        text(locale, 'story184'),
        '',
        ready ? text(locale, 'story185') : text(locale, 'story186'),
      ]);
    },
    choices: [
      {
        id: 'ascend',
        label: text(locale, 'story187'),
        style: 'primary',
        requires: (s) => s.flags.whisper_lore && s.flags.amulet_upgraded && s.flags.spirit_met && s.inventory.includes('scroll'),
      },
      { id: 'ascend_mask', label: text(locale, 'story188'), requires: (s) => s.inventory.includes('masquerade_mask') },
      { id: 'claim_crown', label: text(locale, 'story189'), style: 'danger' },
      { id: 'retreat_throne', label: text(locale, 'story190') },
    ],
  },

  // —— 终局 ——
  treasure: { id: 'treasure', terminal: true, text: T([text(locale, 'story191'), '', text(locale, 'story192')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  ascension: { id: 'ascension', terminal: true, text: T([text(locale, 'story194'), '', text(locale, 'story195')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  wisdom: { id: 'wisdom', terminal: true, text: T([text(locale, 'story196'), '', text(locale, 'story197')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  curse: { id: 'curse', terminal: true, text: T([text(locale, 'story198'), '', text(locale, 'story199')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  escape: { id: 'escape', terminal: true, text: T([text(locale, 'story200'), '', text(locale, 'story201')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  defeat: { id: 'defeat', terminal: true, text: T([text(locale, 'story202'), '', text(locale, 'story203')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  coward: { id: 'coward', terminal: true, text: T([text(locale, 'story204'), '', text(locale, 'story205')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  hermit: { id: 'hermit', terminal: true, text: T([text(locale, 'story206'), '', text(locale, 'story207')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  redemption: { id: 'redemption', terminal: true, text: T([text(locale, 'story208'), '', text(locale, 'story209')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  drowned: { id: 'drowned', terminal: true, text: T([text(locale, 'story210'), '', text(locale, 'story211')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  spider: { id: 'spider', terminal: true, text: T([text(locale, 'story212'), '', text(locale, 'story213')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  labyrinth: { id: 'labyrinth', terminal: true, text: T([text(locale, 'story214'), '', text(locale, 'story215')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  star_keeper: { id: 'star_keeper', terminal: true, text: T([text(locale, 'story216'), '', text(locale, 'story217')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  mask_king: { id: 'mask_king', terminal: true, text: T([text(locale, 'story218'), '', text(locale, 'story219')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  merchant: { id: 'merchant', terminal: true, text: T([text(locale, 'story220'), '', text(locale, 'story221')]), choices: [{ id: 'restart', label: text(locale, 'story193'), style: 'primary' }] },
  };
}

const text = createMessages({
  "story1": {
    "zh-CN": "🌫️ **秘境入口**",
    "en": "🌫️ **Entrance to the Ruins**"
  },
  "story2": {
    "zh-CN": "浓雾散去，你站在古老石门前。左侧是坍塌廊柱，右侧藤蔓小径，远处石塔刺破雾霭。",
    "en": "The mist clears before an ancient stone gate. Fallen columns lie to your left, a vine-covered path to your right, and a stone tower rises in the distance."
  },
  "story3": {
    "zh-CN": "🔥 火把照亮门缝间的幽蓝微光。",
    "en": "🔥 Your torch reveals a blue glow through the gap in the gate."
  },
  "story4": {
    "zh-CN": "💧 泉灵低语：「庭院与星塔皆藏路。」",
    "en": "💧 The spring spirit whispers: “Both the garden and the star tower hide a path.”"
  },
  "story5": {
    "zh-CN": "🗺️ 你记得塔顶俯瞰的全貌：泉、庭、墓、门。",
    "en": "🗺️ You recall the view from the tower: spring, garden, tomb, and gate."
  },
  "story6": {
    "zh-CN": "🚪 推门而入",
    "en": "🚪 Push open the gate"
  },
  "story7": {
    "zh-CN": "🔍 翻找碎石",
    "en": "🔍 Search the rubble"
  },
  "story8": {
    "zh-CN": "🗼 攀登石塔",
    "en": "🗼 Climb the tower"
  },
  "story9": {
    "zh-CN": "🌿 拨开藤蔓",
    "en": "🌿 Clear the vines"
  },
  "story10": {
    "zh-CN": "🏃 转身离开",
    "en": "🏃 Turn back"
  },
  "story11": {
    "zh-CN": "你在坍塌廊柱间翻找，指尖触到冰冷金属。",
    "en": "Searching among the fallen columns, your fingers brush cold metal."
  },
  "story12": {
    "zh-CN": "一把**火把**躺在尘土里；石缝深处还有生锈短剑。",
    "en": "A **torch** lies in the dust; a rusty blade rests deeper in a crack."
  },
  "story13": {
    "zh-CN": "🔥 拾取火把",
    "en": "🔥 Take the torch"
  },
  "story14": {
    "zh-CN": "⚔️ 拾取短剑",
    "en": "⚔️ Take the blade"
  },
  "story15": {
    "zh-CN": "↩️ 返回入口",
    "en": "↩️ Return to the entrance"
  },
  "story16": {
    "zh-CN": "🗼 **瞭望石塔**",
    "en": "🗼 **Watchtower**"
  },
  "story17": {
    "zh-CN": "塔顶风声呼啸，你已记下遗迹布局。",
    "en": "Wind howls at the summit. You have already mapped the ruins."
  },
  "story18": {
    "zh-CN": "螺旋阶梯通向塔顶，视野开阔处或能看清秘境结构。",
    "en": "Spiral stairs lead upward. From the top you might learn the layout of the ruins."
  },
  "story19": {
    "zh-CN": "塔身裂缝中卡着一页星图残角。",
    "en": "A fragment of a star chart is caught in a crack in the tower."
  },
  "story20": {
    "zh-CN": "🗺️ 登高测绘",
    "en": "🗺️ Survey the ruins"
  },
  "story21": {
    "zh-CN": "📄 取星图残页",
    "en": "📄 Take the star chart"
  },
  "story22": {
    "zh-CN": "🔭 进入星象台",
    "en": "🔭 Enter the observatory"
  },
  "story23": {
    "zh-CN": "↩️ 下塔",
    "en": "↩️ Descend the tower"
  },
  "story24": {
    "zh-CN": "🌿 **秘径**",
    "en": "🌿 **Hidden Path**"
  },
  "story25": {
    "zh-CN": "青苔石阶向下，药香与湿土气息交织。",
    "en": "Mossy steps descend through the scent of herbs and damp earth."
  },
  "story26": {
    "zh-CN": "🏡 进入庭院",
    "en": "🏡 Enter the garden"
  },
  "story27": {
    "zh-CN": "🕯️ 火把照亮狭长走廊。",
    "en": "🕯️ Your torch lights a narrow corridor."
  },
  "story28": {
    "zh-CN": "🌑 走廊漆黑，你贴墙摸索。",
    "en": "🌑 The corridor is dark. You feel your way along the wall."
  },
  "story29": {
    "zh-CN": "左侧蓝光（泉）、右侧石阶（墓）、前方积水（淹）、壁画需火光细读。",
    "en": "Blue light marks a spring to the left, steps lead to tombs on the right, and water floods the hall ahead. The mural needs torchlight."
  },
  "story30": {
    "zh-CN": "📜 壁画铭文：光 → 影 → 门。",
    "en": "📜 The mural reads: Light → Shadow → Gate."
  },
  "story31": {
    "zh-CN": "💧 走向蓝光",
    "en": "💧 Follow the blue light"
  },
  "story32": {
    "zh-CN": "⬇️ 走下石阶",
    "en": "⬇️ Descend the steps"
  },
  "story33": {
    "zh-CN": "🌊 踏入积水厅",
    "en": "🌊 Enter the flooded hall"
  },
  "story34": {
    "zh-CN": "🖼️ 研读壁画",
    "en": "🖼️ Study the mural"
  },
  "story35": {
    "zh-CN": "🔔 进入钟楼",
    "en": "🔔 Enter the bell tower"
  },
  "story36": {
    "zh-CN": "↩️ 退回入口",
    "en": "↩️ Retreat to the entrance"
  },
  "story37": {
    "zh-CN": "🖼️ **铭文壁画**",
    "en": "🖼️ **Inscribed Mural**"
  },
  "story38": {
    "zh-CN": "三联画：光、影、门。下角刻序：**光 → 影 → 门**。",
    "en": "Three panels show Light, Shadow, and Gate. An inscription gives the order: **Light → Shadow → Gate**."
  },
  "story39": {
    "zh-CN": "壁画后有一条狭窄画廊，低语声如风穿隙。",
    "en": "Behind the mural, a narrow gallery carries whispers like wind through cracks."
  },
  "story40": {
    "zh-CN": "📝 记下顺序",
    "en": "📝 Remember the sequence"
  },
  "story41": {
    "zh-CN": "👂 进入低语画廊",
    "en": "👂 Enter the whispering gallery"
  },
  "story42": {
    "zh-CN": "↩️ 返回走廊",
    "en": "↩️ Return to the corridor"
  },
  "story43": {
    "zh-CN": "👂 **低语画廊**",
    "en": "👂 **Whispering Gallery**"
  },
  "story44": {
    "zh-CN": "亿万精灵名讳在墙间回响。你听见：「星坠之日，门为封印，非为宝藏。」",
    "en": "Countless elven names echo between the walls. You hear: “When the stars fell, the gate sealed something away. It did not guard treasure.”"
  },
  "story45": {
    "zh-CN": "「守忆者需集月华、星图、泉心三证。」",
    "en": "“A keeper of memory needs three proofs: moonlight, a star chart, and the heart of the spring.”"
  },
  "story46": {
    "zh-CN": "🧘 静心聆听",
    "en": "🧘 Listen closely"
  },
  "story47": {
    "zh-CN": "↩️ 返回壁画室",
    "en": "↩️ Return to the mural room"
  },
  "story48": {
    "zh-CN": "💧 **精灵泉**",
    "en": "💧 **Spirit Spring**"
  },
  "story49": {
    "zh-CN": "泉灵光影朝你颔首。",
    "en": "The spring spirit nods to you."
  },
  "story50": {
    "zh-CN": "水光凝聚为精灵形貌，注视着你。",
    "en": "The shimmering water forms an elven figure, watching you."
  },
  "story51": {
    "zh-CN": "泉水可治愈一次。",
    "en": "The spring can heal you once."
  },
  "story52": {
    "zh-CN": "泉水已无先前效力。",
    "en": "The spring has lost its healing power."
  },
  "story53": {
    "zh-CN": "🍶 饮用泉水",
    "en": "🍶 Drink from the spring"
  },
  "story54": {
    "zh-CN": "💎 取走宝石",
    "en": "💎 Take the gem"
  },
  "story55": {
    "zh-CN": "💬 与泉灵交谈",
    "en": "💬 Talk to the spirit"
  },
  "story56": {
    "zh-CN": "🙏 献宝石换护符",
    "en": "🙏 Trade the gem for an amulet"
  },
  "story57": {
    "zh-CN": "↩️ 离开",
    "en": "↩️ Leave"
  },
  "story58": {
    "zh-CN": "🌊 **积水前厅**",
    "en": "🌊 **Flooded Hall**"
  },
  "story59": {
    "zh-CN": "及膝冷水没过石板，远处有坍塌市集拱门。",
    "en": "Knee-deep cold water covers the slabs. A ruined market arch stands in the distance."
  },
  "story60": {
    "zh-CN": "银羽护体，寒气难侵。",
    "en": "The silver feather shields you from the cold."
  },
  "story61": {
    "zh-CN": "寒意刺骨，久留恐失温。",
    "en": "The chill bites deep. Staying too long risks hypothermia."
  },
  "story62": {
    "zh-CN": "🏚️ 前往废墟市集",
    "en": "🏚️ Head to the ruined market"
  },
  "story63": {
    "zh-CN": "🪶 银羽护体涉水",
    "en": "🪶 Wade with the silver feather"
  },
  "story64": {
    "zh-CN": "🍶 饮灵药暖身",
    "en": "🍶 Drink elixir for warmth"
  },
  "story65": {
    "zh-CN": "🏚️ **废墟市集**",
    "en": "🏚️ **Ruined Market**"
  },
  "story66": {
    "zh-CN": "幽灵摊主陈列面具与古币。「一物换一物，或银币亦可。」",
    "en": "A ghostly merchant displays masks and ancient coins. “An item for an item, or a silver coin.”"
  },
  "story67": {
    "zh-CN": "🎭 银币换面具",
    "en": "🎭 Trade a coin for a mask"
  },
  "story68": {
    "zh-CN": "💎 宝石换银币",
    "en": "💎 Trade the gem for a coin"
  },
  "story69": {
    "zh-CN": "🌉 前往冥河石桥",
    "en": "🌉 Head to the ghost bridge"
  },
  "story70": {
    "zh-CN": "↩️ 离开市集",
    "en": "↩️ Leave the market"
  },
  "story71": {
    "zh-CN": "🏡 **遗忘庭院**",
    "en": "🏡 **Forgotten Garden**"
  },
  "story72": {
    "zh-CN": "银叶古树、紧锁铁门、侧翼温室玻璃碎裂。",
    "en": "An ancient silver-leaved tree, a locked iron gate, and a greenhouse with shattered windows surround you."
  },
  "story73": {
    "zh-CN": "花坛已采过药草。",
    "en": "You have already gathered the herb from the flowerbed."
  },
  "story74": {
    "zh-CN": "花坛闪烁荧光草药。",
    "en": "A luminous herb glimmers in the flowerbed."
  },
  "story75": {
    "zh-CN": "🌿 采集草药",
    "en": "🌿 Gather the herb"
  },
  "story76": {
    "zh-CN": "🌳 树下休息",
    "en": "🌳 Rest under the tree"
  },
  "story77": {
    "zh-CN": "🪴 进入温室",
    "en": "🪴 Enter the greenhouse"
  },
  "story78": {
    "zh-CN": "🔑 打开铁门",
    "en": "🔑 Unlock the iron gate"
  },
  "story79": {
    "zh-CN": "🏠 定居庭院",
    "en": "🏠 Settle in the garden"
  },
  "story80": {
    "zh-CN": "🪴 **破碎温室**",
    "en": "🪴 **Shattered Greenhouse**"
  },
  "story81": {
    "zh-CN": "枯藤缠绕蒸馏器，可萃取草药为灵药。",
    "en": "Dead vines wrap around a still that can distill herbs into elixir."
  },
  "story82": {
    "zh-CN": "⚗️ 萃取灵药",
    "en": "⚗️ Brew elixir"
  },
  "story83": {
    "zh-CN": "↩️ 返回庭院",
    "en": "↩️ Return to the garden"
  },
  "story84": {
    "zh-CN": "📚 **尘封书库**",
    "en": "📚 **Dusty Library**"
  },
  "story85": {
    "zh-CN": "残卷、墙钥、暗门后传来锻炉热气。",
    "en": "Torn scrolls and a wall-mounted key lie nearby. Heat from a forge seeps through a hidden door."
  },
  "story86": {
    "zh-CN": "你已读过秘档。",
    "en": "You have read the secret archive."
  },
  "story87": {
    "zh-CN": "古籍区尚有未读档案。",
    "en": "Unread records remain among the ancient books."
  },
  "story88": {
    "zh-CN": "📜 取卷轴",
    "en": "📜 Take the scroll"
  },
  "story89": {
    "zh-CN": "🔑 取钥匙",
    "en": "🔑 Take the key"
  },
  "story90": {
    "zh-CN": "📖 研读秘档",
    "en": "📖 Read the archive"
  },
  "story91": {
    "zh-CN": "🔥 进入锻炉间",
    "en": "🔥 Enter the forge"
  },
  "story92": {
    "zh-CN": "🔥 **余烬锻炉**",
    "en": "🔥 **Ember Forge**"
  },
  "story93": {
    "zh-CN": "精灵余火仍燃。可淬炼短剑，或升华护符。",
    "en": "Elven embers still burn. They can temper a blade or empower an amulet."
  },
  "story94": {
    "zh-CN": "短剑已淬炼。",
    "en": "The blade is already tempered."
  },
  "story95": {
    "zh-CN": "短剑可淬炼。",
    "en": "The blade can be tempered here."
  },
  "story96": {
    "zh-CN": "⚔️ 淬炼短剑",
    "en": "⚔️ Temper the blade"
  },
  "story97": {
    "zh-CN": "✨ 升华护符",
    "en": "✨ Empower the amulet"
  },
  "story98": {
    "zh-CN": "↩️ 返回书库",
    "en": "↩️ Return to the library"
  },
  "story99": {
    "zh-CN": "🔔 **回音钟楼**",
    "en": "🔔 **Echoing Bell Tower**"
  },
  "story100": {
    "zh-CN": "悬空铜钟布满符纹。钟舌缺失，旁有铸台。",
    "en": "Runes cover a suspended bronze bell. Its clapper is missing; a casting bench stands nearby."
  },
  "story101": {
    "zh-CN": "🔔 敲响铜钟",
    "en": "🔔 Ring the bell"
  },
  "story102": {
    "zh-CN": "⬇️ **地下墓穴**",
    "en": "⬇️ **Underground Tomb**"
  },
  "story103": {
    "zh-CN": "石棺半开，**守墓幽影**凝形扑来！",
    "en": "A sarcophagus stands half-open. A **tomb guardian shade** takes shape and lunges!"
  },
  "story104": {
    "zh-CN": "⚔️ 正面迎战",
    "en": "⚔️ Face it head-on"
  },
  "story105": {
    "zh-CN": "🗡️ 挥剑迎击",
    "en": "🗡️ Strike with the blade"
  },
  "story106": {
    "zh-CN": "🔥 火把驱散",
    "en": "🔥 Drive it off with fire"
  },
  "story107": {
    "zh-CN": "🌿 草药麻痹",
    "en": "🌿 Stun it with the herb"
  },
  "story108": {
    "zh-CN": "🏃 逃跑",
    "en": "🏃 Flee"
  },
  "story109": {
    "zh-CN": "⚰️ **墓道岔口**",
    "en": "⚰️ **Tomb Crossroads**"
  },
  "story110": {
    "zh-CN": "左：封印密室｜右：骸骨甬道｜下：蛛巢暗道",
    "en": "Left: sealed vault | Right: catacombs | Below: spider passage"
  },
  "story111": {
    "zh-CN": "🔐 封印密室",
    "en": "🔐 Sealed vault"
  },
  "story112": {
    "zh-CN": "💀 骸骨甬道",
    "en": "💀 Catacombs"
  },
  "story113": {
    "zh-CN": "🕷️ 蛛巢暗道",
    "en": "🕷️ Spider passage"
  },
  "story114": {
    "zh-CN": "🚪 回音巨门",
    "en": "🚪 Echoing gates"
  },
  "story115": {
    "zh-CN": "🕷️ **蛛巢暗道**",
    "en": "🕷️ **Spider Passage**"
  },
  "story116": {
    "zh-CN": "巨网横亘，蛛眼如灯笼。后方似通暗影迷宫。",
    "en": "A giant web blocks the way. Spider eyes glow like lanterns. Beyond it lies a shadow maze."
  },
  "story117": {
    "zh-CN": "🗡️ 斩网前行",
    "en": "🗡️ Cut through the web"
  },
  "story118": {
    "zh-CN": "🔥 火烧蛛网",
    "en": "🔥 Burn the web"
  },
  "story119": {
    "zh-CN": "🏃 撤退",
    "en": "🏃 Retreat"
  },
  "story120": {
    "zh-CN": "🌑 **暗影迷宫**",
    "en": "🌑 **Shadow Maze**"
  },
  "story121": {
    "zh-CN": "墙壁流动如墨，路径每秒变幻。",
    "en": "Walls flow like ink, and paths shift every second."
  },
  "story122": {
    "zh-CN": "🧭 罗盘定向",
    "en": "🧭 Navigate by compass"
  },
  "story123": {
    "zh-CN": "🚶 随意乱走",
    "en": "🚶 Wander at random"
  },
  "story124": {
    "zh-CN": "↩️ 返回蛛巢",
    "en": "↩️ Return to the spider nest"
  },
  "story125": {
    "zh-CN": "💀 **骸骨甬道**",
    "en": "💀 **Catacombs**"
  },
  "story126": {
    "zh-CN": "压力机关铭刻：诵卷轴真言。侧室铁链锁着幽魂。",
    "en": "An inscription on a pressure trap says: recite the scroll. Chains bind a ghost in a side chamber."
  },
  "story127": {
    "zh-CN": "骸骨手中铜钥闪光。",
    "en": "A bronze key gleams in a skeleton's hand."
  },
  "story128": {
    "zh-CN": "📜 展开卷轴",
    "en": "📜 Unroll the scroll"
  },
  "story129": {
    "zh-CN": "🏃 硬闯机关",
    "en": "🏃 Rush through the trap"
  },
  "story130": {
    "zh-CN": "⛓️ 进入囚室",
    "en": "⛓️ Enter the cell"
  },
  "story131": {
    "zh-CN": "🔑 取铜钥",
    "en": "🔑 Take the bronze key"
  },
  "story132": {
    "zh-CN": "↩️ 返回岔口",
    "en": "↩️ Return to the crossroads"
  },
  "story133": {
    "zh-CN": "⛓️ **幽囚石室**",
    "en": "⛓️ **Ghost Prison**"
  },
  "story134": {
    "zh-CN": "幽魂哀求：「银币可买通行，羽毛可渡冥河。」",
    "en": "The ghost begs: “Silver buys passage. A feather crosses the river of the dead.”"
  },
  "story135": {
    "zh-CN": "墙角埋着古银币。",
    "en": "An ancient silver coin is buried in a corner."
  },
  "story136": {
    "zh-CN": "🪙 取古银币",
    "en": "🪙 Take the ancient coin"
  },
  "story137": {
    "zh-CN": "🕊️ 释放幽魂",
    "en": "🕊️ Free the ghost"
  },
  "story138": {
    "zh-CN": "↩️ 返回甬道",
    "en": "↩️ Return to the catacombs"
  },
  "story139": {
    "zh-CN": "🪦 **骨灰龛室**",
    "en": "🪦 **Ossuary**"
  },
  "story140": {
    "zh-CN": "悬浮护符。幽魂问：「精灵遗迹为何陨落？」",
    "en": "An amulet floats in the air. A ghost asks: “What brought down the elven ruins?”"
  },
  "story141": {
    "zh-CN": "「贪婪与战争」",
    "en": "“Greed and war”"
  },
  "story142": {
    "zh-CN": "「大洪水」",
    "en": "“The great flood”"
  },
  "story143": {
    "zh-CN": "「星辰坠落」",
    "en": "“The falling stars”"
  },
  "story144": {
    "zh-CN": "🌉 **冥河石桥**",
    "en": "🌉 **Ghost Bridge**"
  },
  "story145": {
    "zh-CN": "无栏石桥横跨黑水。守桥者伸手要通行费。",
    "en": "A bare stone bridge spans black water. Its guardian demands a toll."
  },
  "story146": {
    "zh-CN": "🪙 付银币过桥",
    "en": "🪙 Pay a silver coin"
  },
  "story147": {
    "zh-CN": "🪶 银羽渡桥",
    "en": "🪶 Cross with the silver feather"
  },
  "story148": {
    "zh-CN": "↩️ 返回市集",
    "en": "↩️ Return to the market"
  },
  "story149": {
    "zh-CN": "💎 **晶洞**",
    "en": "💎 **Crystal Cave**"
  },
  "story150": {
    "zh-CN": "月华凝于石笋。洞顶飘落银羽。",
    "en": "Moonlight gathers in the stalagmites. A silver feather drifts from the ceiling."
  },
  "story151": {
    "zh-CN": "🌙 取月华碎片",
    "en": "🌙 Take the moon shard"
  },
  "story152": {
    "zh-CN": "🪶 拾银羽",
    "en": "🪶 Take the silver feather"
  },
  "story153": {
    "zh-CN": "💧 前往月池",
    "en": "💧 Head to the moon pool"
  },
  "story154": {
    "zh-CN": "↩️ 返回石桥",
    "en": "↩️ Return to the bridge"
  },
  "story155": {
    "zh-CN": "🌙 **月影池**",
    "en": "🌙 **Moon Pool**"
  },
  "story156": {
    "zh-CN": "池水映月。星图残页可与之共鸣。",
    "en": "The pool reflects the moon. A star chart fragment might resonate with it."
  },
  "story157": {
    "zh-CN": "月华已赐福。",
    "en": "You have received the moon's blessing."
  },
  "story158": {
    "zh-CN": "池底似有水下沉殿。",
    "en": "A submerged shrine seems to lie below."
  },
  "story159": {
    "zh-CN": "📄 星图共鸣",
    "en": "📄 Align the star chart"
  },
  "story160": {
    "zh-CN": "🤿 潜入沉殿",
    "en": "🤿 Dive to the shrine"
  },
  "story161": {
    "zh-CN": "↩️ 返回晶洞",
    "en": "↩️ Return to the crystal cave"
  },
  "story162": {
    "zh-CN": "🛕 **水下沉殿**",
    "en": "🛕 **Sunken Shrine**"
  },
  "story163": {
    "zh-CN": "三证石台：月华、星图、泉心印记。缺一则门不开。",
    "en": "The altar requires three proofs: moonlight, a star chart, and the spring's mark. Without all three, the gate stays shut."
  },
  "story164": {
    "zh-CN": "✨ 完成星守仪式",
    "en": "✨ Complete the star keeper ritual"
  },
  "story165": {
    "zh-CN": "↩️ 浮上水面",
    "en": "↩️ Return to the surface"
  },
  "story166": {
    "zh-CN": "🔭 **星象台**",
    "en": "🔭 **Observatory**"
  },
  "story167": {
    "zh-CN": "铜制浑天仪缺损。可校准罗盘。",
    "en": "The bronze armillary sphere is damaged. You can calibrate a compass here."
  },
  "story168": {
    "zh-CN": "🧭 校准罗盘",
    "en": "🧭 Calibrate the compass"
  },
  "story169": {
    "zh-CN": "🚪 **回音巨门**",
    "en": "🚪 **Echoing Gates**"
  },
  "story170": {
    "zh-CN": "铃、罗盘、钥三缺一时铭文闪烁。门后是封印内庭捷径。",
    "en": "The inscription flashes unless bell, compass, and key are all present. A shortcut to the sealed inner court lies beyond."
  },
  "story171": {
    "zh-CN": "🔓 开启巨门",
    "en": "🔓 Open the gates"
  },
  "story172": {
    "zh-CN": "🔐 **封印密室**",
    "en": "🔐 **Sealed Vault**"
  },
  "story173": {
    "zh-CN": "三雕像：光、影、门。",
    "en": "Three statues: Light, Shadow, and Gate."
  },
  "story174": {
    "zh-CN": "顺序：光 → 影 → 门。",
    "en": "The order is Light → Shadow → Gate."
  },
  "story175": {
    "zh-CN": "顺序未知。",
    "en": "The sequence is unknown."
  },
  "story176": {
    "zh-CN": "光→影→门",
    "en": "Light → Shadow → Gate"
  },
  "story177": {
    "zh-CN": "门→光→影",
    "en": "Gate → Light → Shadow"
  },
  "story178": {
    "zh-CN": "影→门→光",
    "en": "Shadow → Gate → Light"
  },
  "story179": {
    "zh-CN": "✨ **封印已解**",
    "en": "✨ **Seal Broken**"
  },
  "story180": {
    "zh-CN": "升华护符引路，王座厅近在咫尺。",
    "en": "The empowered amulet guides you. The throne room is close."
  },
  "story181": {
    "zh-CN": "螺旋阶梯通向王座厅。",
    "en": "Spiral stairs lead to the throne room."
  },
  "story182": {
    "zh-CN": "⬇️ 王座厅",
    "en": "⬇️ Enter the throne room"
  },
  "story183": {
    "zh-CN": "💰 取宝离开",
    "en": "💰 Take treasure and leave"
  },
  "story184": {
    "zh-CN": "👑 **精灵王座厅**",
    "en": "👑 **Elven Throne Room**"
  },
  "story185": {
    "zh-CN": "三证齐聚，王座虚影恭迎守忆者。",
    "en": "The three proofs are gathered. A spectral figure welcomes the keeper of memory."
  },
  "story186": {
    "zh-CN": "王座冷光闪烁，贸然落座恐遭反噬。",
    "en": "Cold light flickers on the throne. Sitting down unprepared may be disastrous."
  },
  "story187": {
    "zh-CN": "✨ 星辉归位",
    "en": "✨ Restore the starlight"
  },
  "story188": {
    "zh-CN": "🎭 面具加冕",
    "en": "🎭 Claim the masked crown"
  },
  "story189": {
    "zh-CN": "👑 坐上王座",
    "en": "👑 Sit on the throne"
  },
  "story190": {
    "zh-CN": "🏃 取宝离开",
    "en": "🏃 Take treasure and leave"
  },
  "story191": {
    "zh-CN": "🏆 **遗迹宝藏**",
    "en": "🏆 **Treasure of the Ruins**"
  },
  "story192": {
    "zh-CN": "琥珀星光入袋，你成为传说。",
    "en": "With amber starlight in your pack, you become a legend."
  },
  "story193": {
    "zh-CN": "🔄 再玩一次",
    "en": "🔄 Play again"
  },
  "story194": {
    "zh-CN": "🌟 **星辉归位**",
    "en": "🌟 **Starlight Restored**"
  },
  "story195": {
    "zh-CN": "你成为守忆者，历史因你而不朽。",
    "en": "You become the keeper of memory. Through you, history endures."
  },
  "story196": {
    "zh-CN": "📜 **智者归途**",
    "en": "📜 **A Scholar's Return**"
  },
  "story197": {
    "zh-CN": "你携记忆离去，无宝亦足。",
    "en": "You leave with memories. Treasure is unnecessary."
  },
  "story198": {
    "zh-CN": "☠️ **贪婪代价**",
    "en": "☠️ **The Price of Greed**"
  },
  "story199": {
    "zh-CN": "王座吞噬了你。",
    "en": "The throne consumes you."
  },
  "story200": {
    "zh-CN": "🌅 **生还**",
    "en": "🌅 **Survival**"
  },
  "story201": {
    "zh-CN": "遗迹坍塌，你活着出来。",
    "en": "The ruins collapse, but you escape alive."
  },
  "story202": {
    "zh-CN": "💀 **陨落**",
    "en": "💀 **Fallen**"
  },
  "story203": {
    "zh-CN": "秘境再添无名骸骨。",
    "en": "The ruins gain another nameless skeleton."
  },
  "story204": {
    "zh-CN": "🏠 **怯懦归途**",
    "en": "🏠 **A Coward's Return**"
  },
  "story205": {
    "zh-CN": "你从未入门。",
    "en": "You never crossed the threshold."
  },
  "story206": {
    "zh-CN": "🌳 **庭院隐者**",
    "en": "🌳 **Garden Hermit**"
  },
  "story207": {
    "zh-CN": "你在古树下定居，与遗迹共生。",
    "en": "You settle beneath the ancient tree and live alongside the ruins."
  },
  "story208": {
    "zh-CN": "🕊️ **幽魂解脱**",
    "en": "🕊️ **A Spirit Set Free**"
  },
  "story209": {
    "zh-CN": "你渡魂过桥，获冥府祝福。",
    "en": "You guide a soul across the bridge and earn the underworld's blessing."
  },
  "story210": {
    "zh-CN": "🌊 **寒水沉眠**",
    "en": "🌊 **Cold-Water Slumber**"
  },
  "story211": {
    "zh-CN": "积水厅吞没意识。",
    "en": "The flooded hall swallows your consciousness."
  },
  "story212": {
    "zh-CN": "🕷️ **茧中亡魂**",
    "en": "🕷️ **Soul in a Cocoon**"
  },
  "story213": {
    "zh-CN": "巨蛛将你制成茧。",
    "en": "The giant spider wraps you in silk."
  },
  "story214": {
    "zh-CN": "🌑 **迷宫迷失**",
    "en": "🌑 **Lost in the Maze**"
  },
  "story215": {
    "zh-CN": "暗影吞没方向感。",
    "en": "The shadows swallow your sense of direction."
  },
  "story216": {
    "zh-CN": "🌙 **星守誓约**",
    "en": "🌙 **Star Keeper's Oath**"
  },
  "story217": {
    "zh-CN": "你镇守月池，成为精灵最后的灯塔。",
    "en": "You guard the moon pool, the last beacon of the elves."
  },
  "story218": {
    "zh-CN": "🎭 **面具之王**",
    "en": "🎭 **King of Masks**"
  },
  "story219": {
    "zh-CN": "面具与王座融合，你统治空城。",
    "en": "Mask and throne merge. You rule an empty city."
  },
  "story220": {
    "zh-CN": "💰 **行商结局**",
    "en": "💰 **The Merchant's Ending**"
  },
  "story221": {
    "zh-CN": "你满载银币离开，遗迹不过集市。",
    "en": "You leave laden with silver. The ruins were merely a market."
  }
});

export const SCENES = createScenes('zh-CN');
const EN_SCENES = createScenes('en');

export function sceneCatalog(locale: Locale = 'zh-CN'): Readonly<Record<string, Scene>> {
  return locale === 'en' ? EN_SCENES : SCENES;
}

export function countScenes(): { total: number; playable: number; terminals: number } {
  const all = Object.values(SCENES);
  const terminals = all.filter((s) => s.terminal).length;
  return { total: all.length, playable: all.length - terminals, terminals };
}
