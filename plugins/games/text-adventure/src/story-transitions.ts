import type { ChoiceResult, GameState } from './story-types.js';

export function resolveTransition(state: GameState, choiceId: string): ChoiceResult | null {
  const { sceneId } = state;

  if (choiceId === 'restart') {
    return { nextSceneId: 'start', hpDelta: 100 - state.hp, endingId: '' };
  }

  if (sceneId === 'flooded_hall' && choiceId === 'wade_market') {
    const hp = state.hp - 25;
    if (hp <= 0) return { nextSceneId: 'drowned', hpDelta: -25, endingId: 'drowned' };
    return { nextSceneId: 'market_ruins', hpDelta: -25 };
  }

  const hpFail = (next: string, delta: number): ChoiceResult => ({
    nextSceneId: state.hp + delta <= 0 ? 'defeat' : next,
    hpDelta: delta,
    endingId: state.hp + delta <= 0 ? 'defeat' : '',
  });

  const map: Record<string, Record<string, ChoiceResult>> = {
    start: {
      push_door: { nextSceneId: 'corridor' },
      search_rubble: { nextSceneId: 'rubble' },
      climb_tower: { nextSceneId: 'watchtower' },
      vine_path: { nextSceneId: 'vine_path' },
      leave: { nextSceneId: 'coward', endingId: 'coward' },
    },
    rubble: {
      take_torch: { nextSceneId: 'start', addItem: 'torch' },
      take_blade: { nextSceneId: 'start', addItem: 'rusted_blade' },
      back_entrance: { nextSceneId: 'start' },
    },
    watchtower: {
      survey_map: { nextSceneId: 'watchtower', setFlag: 'saw_map' },
      take_chart_fragment: { nextSceneId: 'watchtower', addItem: 'star_chart' },
      enter_observatory: { nextSceneId: 'observatory' },
      descend_tower: { nextSceneId: 'start' },
    },
    vine_path: {
      enter_garden: { nextSceneId: 'garden' },
      back_entrance: { nextSceneId: 'start' },
    },
    corridor: {
      go_blue: { nextSceneId: 'spring' },
      go_stairs: { nextSceneId: 'depths' },
      go_flooded: { nextSceneId: 'flooded_hall' },
      study_mural: { nextSceneId: 'mural_room' },
      enter_bell_tower: { nextSceneId: 'bell_tower' },
      go_back: { nextSceneId: 'start' },
    },
    mural_room: {
      memorize: { nextSceneId: 'mural_room', setFlag: 'knows_sequence' },
      enter_whisper: { nextSceneId: 'whisper_gallery' },
      back_corridor: { nextSceneId: 'corridor' },
    },
    whisper_gallery: {
      listen_deep: { nextSceneId: 'whisper_gallery', setFlag: 'whisper_lore' },
      back_mural: { nextSceneId: 'mural_room' },
    },
    spring: {
      drink: { nextSceneId: 'spring', hpDelta: 30, setFlag: 'healed' },
      take_gem: { nextSceneId: 'spring', addItem: 'gem' },
      talk_spirit: { nextSceneId: 'spring', setFlag: 'spirit_met' },
      offer_gem: { nextSceneId: 'spring', removeItem: 'gem', addItem: 'amulet', setFlag: 'spirit_blessed' },
      leave_spring: { nextSceneId: 'corridor' },
    },
    flooded_hall: {
      use_feather_wade: { nextSceneId: 'market_ruins', removeItem: 'elf_feather' },
      drink_elixir_warm: { nextSceneId: 'market_ruins', removeItem: 'elixir' },
      back_corridor: { nextSceneId: 'corridor' },
    },
    market_ruins: {
      buy_mask_coin: { nextSceneId: 'market_ruins', removeItem: 'silver_coin', addItem: 'masquerade_mask' },
      trade_gem_coin: { nextSceneId: 'market_ruins', removeItem: 'gem', addItem: 'silver_coin' },
      go_bridge: { nextSceneId: 'ghost_bridge' },
      leave_market: { nextSceneId: 'flooded_hall' },
    },
    garden: {
      pick_herb: { nextSceneId: 'garden', addItem: 'herb' },
      rest_tree: { nextSceneId: 'garden', hpDelta: 20, setFlag: 'rested' },
      enter_greenhouse: { nextSceneId: 'greenhouse' },
      open_iron_door: { nextSceneId: 'library' },
      stay_forever: { nextSceneId: 'hermit', endingId: 'hermit' },
      back_corridor: { nextSceneId: 'corridor' },
    },
    greenhouse: {
      brew_elixir: { nextSceneId: 'greenhouse', removeItem: 'herb', addItem: 'elixir' },
      back_garden: { nextSceneId: 'garden' },
    },
    library: {
      take_scroll: { nextSceneId: 'library', addItem: 'scroll' },
      take_key: { nextSceneId: 'library', addItem: 'key' },
      read_archive: { nextSceneId: 'library', setFlag: 'read_archive' },
      enter_forge: { nextSceneId: 'ember_forge' },
      back_garden: { nextSceneId: 'garden' },
    },
    ember_forge: {
      forge_blade: { nextSceneId: 'ember_forge', setFlag: 'forged_blade' },
      upgrade_amulet: { nextSceneId: 'ember_forge', removeItem: 'moon_shard', setFlag: 'amulet_upgraded' },
      back_library: { nextSceneId: 'library' },
    },
    bell_tower: {
      ring_bell: { nextSceneId: 'bell_tower', addItem: 'spirit_bell' },
      back_corridor: { nextSceneId: 'corridor' },
    },
    depths: {
      fight: hpFail('crypt_entry', -50),
      fight_blade: { nextSceneId: 'crypt_entry', hpDelta: -20, setFlag: 'shadow_banished' },
      use_torch: { nextSceneId: 'crypt_entry', setFlag: 'shadow_banished' },
      use_herb: { nextSceneId: 'crypt_entry', removeItem: 'herb', setFlag: 'shadow_banished' },
      flee: { nextSceneId: 'escape', endingId: 'escape' },
    },
    crypt_entry: {
      go_vault: { nextSceneId: 'vault' },
      go_catacombs: { nextSceneId: 'catacombs' },
      go_spider: { nextSceneId: 'spider_nest' },
      go_sealed: { nextSceneId: 'sealed_gates' },
      back_corridor: { nextSceneId: 'corridor' },
    },
    spider_nest: {
      cut_web_blade: { nextSceneId: 'shadow_maze' },
      burn_web: { nextSceneId: 'shadow_maze' },
      flee_spider: { nextSceneId: 'spider', endingId: 'spider' },
    },
    shadow_maze: {
      navigate_compass: { nextSceneId: 'crystal_cave' },
      wander_maze: { nextSceneId: 'labyrinth', endingId: 'labyrinth' },
      back_spider: { nextSceneId: 'spider_nest' },
    },
    catacombs: {
      read_scroll: { nextSceneId: 'ossuary' },
      dash_trap: hpFail('ossuary', -35),
      enter_prison: { nextSceneId: 'prison_cell' },
      take_key_skeleton: { nextSceneId: 'catacombs', addItem: 'key' },
      back_crypt: { nextSceneId: 'crypt_entry' },
    },
    prison_cell: {
      take_coin: { nextSceneId: 'prison_cell', addItem: 'silver_coin' },
      free_ghost: { nextSceneId: 'redemption', endingId: 'redemption' },
      back_catacombs: { nextSceneId: 'catacombs' },
    },
    ossuary: {
      answer_greed: { nextSceneId: 'ossuary', hpDelta: -25 },
      answer_flood: { nextSceneId: 'wisdom', endingId: 'wisdom' },
      answer_star: { nextSceneId: 'ossuary', addItem: 'amulet' },
      back_catacombs: { nextSceneId: 'catacombs' },
    },
    ghost_bridge: {
      pay_coin: { nextSceneId: 'crystal_cave', removeItem: 'silver_coin' },
      cross_feather: { nextSceneId: 'crystal_cave', removeItem: 'elf_feather' },
      back_market: { nextSceneId: 'market_ruins' },
    },
    crystal_cave: {
      take_moon_shard: { nextSceneId: 'crystal_cave', addItem: 'moon_shard' },
      take_feather: { nextSceneId: 'crystal_cave', addItem: 'elf_feather' },
      enter_moon_pool: { nextSceneId: 'moon_pool' },
      back_bridge: { nextSceneId: 'ghost_bridge' },
    },
    moon_pool: {
      align_chart: { nextSceneId: 'moon_pool', setFlag: 'moon_blessed' },
      dive_shrine: { nextSceneId: 'sunken_shrine' },
      back_crystal: { nextSceneId: 'crystal_cave' },
    },
    sunken_shrine: {
      ritual_star_keeper: { nextSceneId: 'star_keeper', endingId: 'star_keeper' },
      back_moon_pool: { nextSceneId: 'moon_pool' },
    },
    observatory: {
      craft_compass: { nextSceneId: 'observatory', addItem: 'compass' },
      back_tower: { nextSceneId: 'watchtower' },
    },
    sealed_gates: {
      open_gates: { nextSceneId: 'vault' },
      back_crypt: { nextSceneId: 'crypt_entry' },
    },
    vault: {
      seq_light_shadow_door: { nextSceneId: 'vault_open' },
      seq_door_light_shadow: { nextSceneId: 'wisdom', endingId: 'wisdom' },
      seq_shadow_door_light: { nextSceneId: 'defeat', hpDelta: -100, endingId: 'defeat' },
      back_crypt: { nextSceneId: 'crypt_entry' },
    },
    vault_open: {
      descend_throne: { nextSceneId: 'throne_room' },
      take_treasure_now: { nextSceneId: 'treasure', endingId: 'treasure' },
      back_crypt: { nextSceneId: 'crypt_entry' },
    },
    throne_room: {
      ascend: { nextSceneId: 'ascension', endingId: 'ascension' },
      ascend_mask: { nextSceneId: 'mask_king', endingId: 'mask_king' },
      claim_crown: { nextSceneId: 'curse', endingId: 'curse' },
      retreat_throne: { nextSceneId: 'treasure', endingId: 'treasure' },
    },
  };

  return map[sceneId]?.[choiceId] ?? null;
}
