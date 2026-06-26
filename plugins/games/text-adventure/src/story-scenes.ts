import type { GameState, Scene } from './story-types.js';

const T = (lines: string[]) => lines.join('\n');

/** 非终局场景 28 个 + 终局 12 个 */
export const SCENES: Record<string, Scene> = {
  start: {
    id: 'start',
    text: (s) => {
      const lines = [
        '🌫️ **秘境入口**',
        '',
        '浓雾散去，你站在古老石门前。左侧是坍塌廊柱，右侧藤蔓小径，远处石塔刺破雾霭。',
      ];
      if (s.inventory.includes('torch')) lines.push('', '🔥 火把照亮门缝间的幽蓝微光。');
      if (s.flags.spirit_met) lines.push('', '💧 泉灵低语：「庭院与星塔皆藏路。」');
      if (s.flags.saw_map) lines.push('', '🗺️ 你记得塔顶俯瞰的全貌：泉、庭、墓、门。');
      return lines.join('\n');
    },
    choices: [
      { id: 'push_door', label: '🚪 推门而入', style: 'primary' },
      { id: 'search_rubble', label: '🔍 翻找碎石' },
      { id: 'climb_tower', label: '🗼 攀登石塔' },
      { id: 'vine_path', label: '🌿 拨开藤蔓', requires: (s) => s.flags.spirit_met },
      { id: 'leave', label: '🏃 转身离开', style: 'danger' },
    ],
  },

  rubble: {
    id: 'rubble',
    text: T([
      '你在坍塌廊柱间翻找，指尖触到冰冷金属。',
      '一把**火把**躺在尘土里；石缝深处还有生锈短剑。',
    ]),
    choices: [
      { id: 'take_torch', label: '🔥 拾取火把', requires: (s) => !s.inventory.includes('torch') },
      { id: 'take_blade', label: '⚔️ 拾取短剑', requires: (s) => !s.inventory.includes('rusted_blade') },
      { id: 'back_entrance', label: '↩️ 返回入口' },
    ],
  },

  watchtower: {
    id: 'watchtower',
    text: (s) => T([
      '🗼 **瞭望石塔**',
      '',
      s.flags.saw_map
        ? '塔顶风声呼啸，你已记下遗迹布局。'
        : '螺旋阶梯通向塔顶，视野开阔处或能看清秘境结构。',
      '塔身裂缝中卡着一页星图残角。',
    ]),
    choices: [
      { id: 'survey_map', label: '🗺️ 登高测绘', requires: (s) => !s.flags.saw_map },
      { id: 'take_chart_fragment', label: '📄 取星图残页', requires: (s) => !s.inventory.includes('star_chart') },
      { id: 'enter_observatory', label: '🔭 进入星象台', requires: (s) => s.flags.saw_map },
      { id: 'descend_tower', label: '↩️ 下塔' },
    ],
  },

  vine_path: {
    id: 'vine_path',
    text: T(['🌿 **秘径**', '', '青苔石阶向下，药香与湿土气息交织。']),
    choices: [
      { id: 'enter_garden', label: '🏡 进入庭院' },
      { id: 'back_entrance', label: '↩️ 返回入口' },
    ],
  },

  corridor: {
    id: 'corridor',
    text: (s) => {
      const lit = s.inventory.includes('torch');
      const lines = [
        lit ? '🕯️ 火把照亮狭长走廊。' : '🌑 走廊漆黑，你贴墙摸索。',
        '左侧蓝光（泉）、右侧石阶（墓）、前方积水（淹）、壁画需火光细读。',
      ];
      if (s.flags.knows_sequence) lines.push('', '📜 壁画铭文：光 → 影 → 门。');
      return lines.join('\n');
    },
    choices: [
      { id: 'go_blue', label: '💧 走向蓝光' },
      { id: 'go_stairs', label: '⬇️ 走下石阶' },
      { id: 'go_flooded', label: '🌊 踏入积水厅' },
      { id: 'study_mural', label: '🖼️ 研读壁画', requires: (s) => s.inventory.includes('torch') },
      { id: 'enter_bell_tower', label: '🔔 进入钟楼', requires: (s) => s.flags.spirit_met },
      { id: 'go_back', label: '↩️ 退回入口' },
    ],
  },

  mural_room: {
    id: 'mural_room',
    text: T([
      '🖼️ **铭文壁画**',
      '',
      '三联画：光、影、门。下角刻序：**光 → 影 → 门**。',
      '壁画后有一条狭窄画廊，低语声如风穿隙。',
    ]),
    choices: [
      { id: 'memorize', label: '📝 记下顺序' },
      { id: 'enter_whisper', label: '👂 进入低语画廊', requires: (s) => s.flags.knows_sequence },
      { id: 'back_corridor', label: '↩️ 返回走廊' },
    ],
  },

  whisper_gallery: {
    id: 'whisper_gallery',
    text: T([
      '👂 **低语画廊**',
      '',
      '亿万精灵名讳在墙间回响。你听见：「星坠之日，门为封印，非为宝藏。」',
      '「守忆者需集月华、星图、泉心三证。」',
    ]),
    choices: [
      { id: 'listen_deep', label: '🧘 静心聆听', requires: (s) => !s.flags.whisper_lore },
      { id: 'back_mural', label: '↩️ 返回壁画室' },
    ],
  },

  spring: {
    id: 'spring',
    text: (s) => T([
      '💧 **精灵泉**',
      '',
      s.flags.spirit_met ? '泉灵光影朝你颔首。' : '水光凝聚为精灵形貌，注视着你。',
      !s.flags.healed ? '泉水可治愈一次。' : '泉水已无先前效力。',
    ]),
    choices: [
      { id: 'drink', label: '🍶 饮用泉水', requires: (s) => !s.flags.healed },
      { id: 'take_gem', label: '💎 取走宝石', requires: (s) => !s.inventory.includes('gem') },
      { id: 'talk_spirit', label: '💬 与泉灵交谈', requires: (s) => !s.flags.spirit_met },
      { id: 'offer_gem', label: '🙏 献宝石换护符', requires: (s) => s.inventory.includes('gem') && !s.inventory.includes('amulet') },
      { id: 'leave_spring', label: '↩️ 离开' },
    ],
  },

  flooded_hall: {
    id: 'flooded_hall',
    text: (s) => T([
      '🌊 **积水前厅**',
      '',
      '及膝冷水没过石板，远处有坍塌市集拱门。',
      s.inventory.includes('elf_feather') ? '银羽护体，寒气难侵。' : '寒意刺骨，久留恐失温。',
    ]),
    choices: [
      { id: 'wade_market', label: '🏚️ 前往废墟市集' },
      { id: 'use_feather_wade', label: '🪶 银羽护体涉水', requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'drink_elixir_warm', label: '🍶 饮灵药暖身', requires: (s) => s.inventory.includes('elixir') },
      { id: 'back_corridor', label: '↩️ 返回走廊' },
    ],
  },

  market_ruins: {
    id: 'market_ruins',
    text: T([
      '🏚️ **废墟市集**',
      '',
      '幽灵摊主陈列面具与古币。「一物换一物，或银币亦可。」',
    ]),
    choices: [
      { id: 'buy_mask_coin', label: '🎭 银币换面具', requires: (s) => s.inventory.includes('silver_coin') && !s.inventory.includes('masquerade_mask') },
      { id: 'trade_gem_coin', label: '💎 宝石换银币', requires: (s) => s.inventory.includes('gem') },
      { id: 'go_bridge', label: '🌉 前往冥河石桥' },
      { id: 'leave_market', label: '↩️ 离开市集' },
    ],
  },

  garden: {
    id: 'garden',
    text: (s) => T([
      '🏡 **遗忘庭院**',
      '',
      '银叶古树、紧锁铁门、侧翼温室玻璃碎裂。',
      s.inventory.includes('herb') ? '花坛已采过药草。' : '花坛闪烁荧光草药。',
    ]),
    choices: [
      { id: 'pick_herb', label: '🌿 采集草药', requires: (s) => !s.inventory.includes('herb') },
      { id: 'rest_tree', label: '🌳 树下休息', requires: (s) => !s.flags.rested },
      { id: 'enter_greenhouse', label: '🪴 进入温室' },
      { id: 'open_iron_door', label: '🔑 打开铁门', requires: (s) => s.inventory.includes('key') },
      { id: 'stay_forever', label: '🏠 定居庭院', requires: (s) => s.flags.rested && s.flags.spirit_met },
      { id: 'back_corridor', label: '↩️ 返回走廊' },
    ],
  },

  greenhouse: {
    id: 'greenhouse',
    text: T([
      '🪴 **破碎温室**',
      '',
      '枯藤缠绕蒸馏器，可萃取草药为灵药。',
    ]),
    choices: [
      { id: 'brew_elixir', label: '⚗️ 萃取灵药', requires: (s) => s.inventory.includes('herb') && !s.inventory.includes('elixir') },
      { id: 'back_garden', label: '↩️ 返回庭院' },
    ],
  },

  library: {
    id: 'library',
    text: (s) => T([
      '📚 **尘封书库**',
      '',
      '残卷、墙钥、暗门后传来锻炉热气。',
      s.flags.read_archive ? '你已读过秘档。' : '古籍区尚有未读档案。',
    ]),
    choices: [
      { id: 'take_scroll', label: '📜 取卷轴', requires: (s) => !s.inventory.includes('scroll') },
      { id: 'take_key', label: '🔑 取钥匙', requires: (s) => !s.inventory.includes('key') },
      { id: 'read_archive', label: '📖 研读秘档', requires: (s) => !s.flags.read_archive },
      { id: 'enter_forge', label: '🔥 进入锻炉间', requires: (s) => s.inventory.includes('scroll') },
      { id: 'back_garden', label: '↩️ 返回庭院' },
    ],
  },

  ember_forge: {
    id: 'ember_forge',
    text: (s) => T([
      '🔥 **余烬锻炉**',
      '',
      '精灵余火仍燃。可淬炼短剑，或升华护符。',
      s.flags.forged_blade ? '短剑已淬炼。' : '短剑可淬炼。',
    ]),
    choices: [
      { id: 'forge_blade', label: '⚔️ 淬炼短剑', requires: (s) => s.inventory.includes('rusted_blade') && !s.flags.forged_blade },
      { id: 'upgrade_amulet', label: '✨ 升华护符', requires: (s) => s.inventory.includes('amulet') && s.inventory.includes('moon_shard') && !s.flags.amulet_upgraded },
      { id: 'back_library', label: '↩️ 返回书库' },
    ],
  },

  bell_tower: {
    id: 'bell_tower',
    text: T([
      '🔔 **回音钟楼**',
      '',
      '悬空铜钟布满符纹。钟舌缺失，旁有铸台。',
    ]),
    choices: [
      { id: 'ring_bell', label: '🔔 敲响铜钟', requires: (s) => !s.inventory.includes('spirit_bell') },
      { id: 'back_corridor', label: '↩️ 返回走廊' },
    ],
  },

  depths: {
    id: 'depths',
    text: T([
      '⬇️ **地下墓穴**',
      '',
      '石棺半开，**守墓幽影**凝形扑来！',
    ]),
    choices: [
      { id: 'fight', label: '⚔️ 正面迎战', style: 'danger' },
      { id: 'fight_blade', label: '🗡️ 挥剑迎击', requires: (s) => s.flags.forged_blade },
      { id: 'use_torch', label: '🔥 火把驱散', requires: (s) => s.inventory.includes('torch') },
      { id: 'use_herb', label: '🌿 草药麻痹', requires: (s) => s.inventory.includes('herb') },
      { id: 'flee', label: '🏃 逃跑' },
    ],
  },

  crypt_entry: {
    id: 'crypt_entry',
    text: T([
      '⚰️ **墓道岔口**',
      '',
      '左：封印密室｜右：骸骨甬道｜下：蛛巢暗道',
    ]),
    choices: [
      { id: 'go_vault', label: '🔐 封印密室' },
      { id: 'go_catacombs', label: '💀 骸骨甬道' },
      { id: 'go_spider', label: '🕷️ 蛛巢暗道' },
      { id: 'go_sealed', label: '🚪 回音巨门', requires: (s) => s.inventory.includes('spirit_bell') && s.inventory.includes('compass') },
      { id: 'back_corridor', label: '↩️ 返回走廊' },
    ],
  },

  spider_nest: {
    id: 'spider_nest',
    text: T([
      '🕷️ **蛛巢暗道**',
      '',
      '巨网横亘，蛛眼如灯笼。后方似通暗影迷宫。',
    ]),
    choices: [
      { id: 'cut_web_blade', label: '🗡️ 斩网前行', requires: (s) => s.flags.forged_blade },
      { id: 'burn_web', label: '🔥 火烧蛛网', requires: (s) => s.inventory.includes('torch') },
      { id: 'flee_spider', label: '🏃 撤退', style: 'danger' },
    ],
  },

  shadow_maze: {
    id: 'shadow_maze',
    text: T([
      '🌑 **暗影迷宫**',
      '',
      '墙壁流动如墨，路径每秒变幻。',
    ]),
    choices: [
      { id: 'navigate_compass', label: '🧭 罗盘定向', requires: (s) => s.inventory.includes('compass') },
      { id: 'wander_maze', label: '🚶 随意乱走', style: 'danger' },
      { id: 'back_spider', label: '↩️ 返回蛛巢' },
    ],
  },

  catacombs: {
    id: 'catacombs',
    text: T([
      '💀 **骸骨甬道**',
      '',
      '压力机关铭刻：诵卷轴真言。侧室铁链锁着幽魂。',
      '骸骨手中铜钥闪光。',
    ]),
    choices: [
      { id: 'read_scroll', label: '📜 展开卷轴', requires: (s) => s.inventory.includes('scroll') },
      { id: 'dash_trap', label: '🏃 硬闯机关', style: 'danger' },
      { id: 'enter_prison', label: '⛓️ 进入囚室' },
      { id: 'take_key_skeleton', label: '🔑 取铜钥', requires: (s) => !s.inventory.includes('key') },
      { id: 'back_crypt', label: '↩️ 返回岔口' },
    ],
  },

  prison_cell: {
    id: 'prison_cell',
    text: T([
      '⛓️ **幽囚石室**',
      '',
      '幽魂哀求：「银币可买通行，羽毛可渡冥河。」',
      '墙角埋着古银币。',
    ]),
    choices: [
      { id: 'take_coin', label: '🪙 取古银币', requires: (s) => !s.inventory.includes('silver_coin') },
      { id: 'free_ghost', label: '🕊️ 释放幽魂', requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'back_catacombs', label: '↩️ 返回甬道' },
    ],
  },

  ossuary: {
    id: 'ossuary',
    text: T([
      '🪦 **骨灰龛室**',
      '',
      '悬浮护符。幽魂问：「精灵遗迹为何陨落？」',
    ]),
    choices: [
      { id: 'answer_greed', label: '「贪婪与战争」' },
      { id: 'answer_flood', label: '「大洪水」' },
      { id: 'answer_star', label: '「星辰坠落」', style: 'primary' },
      { id: 'back_catacombs', label: '↩️ 返回甬道' },
    ],
  },

  ghost_bridge: {
    id: 'ghost_bridge',
    text: T([
      '🌉 **冥河石桥**',
      '',
      '无栏石桥横跨黑水。守桥者伸手要通行费。',
    ]),
    choices: [
      { id: 'pay_coin', label: '🪙 付银币过桥', requires: (s) => s.inventory.includes('silver_coin') },
      { id: 'cross_feather', label: '🪶 银羽渡桥', requires: (s) => s.inventory.includes('elf_feather') },
      { id: 'back_market', label: '↩️ 返回市集' },
    ],
  },

  crystal_cave: {
    id: 'crystal_cave',
    text: T([
      '💎 **晶洞**',
      '',
      '月华凝于石笋。洞顶飘落银羽。',
    ]),
    choices: [
      { id: 'take_moon_shard', label: '🌙 取月华碎片', requires: (s) => !s.inventory.includes('moon_shard') },
      { id: 'take_feather', label: '🪶 拾银羽', requires: (s) => !s.inventory.includes('elf_feather') },
      { id: 'enter_moon_pool', label: '💧 前往月池' },
      { id: 'back_bridge', label: '↩️ 返回石桥' },
    ],
  },

  moon_pool: {
    id: 'moon_pool',
    text: (s) => T([
      '🌙 **月影池**',
      '',
      '池水映月。星图残页可与之共鸣。',
      s.flags.moon_blessed ? '月华已赐福。' : '池底似有水下沉殿。',
    ]),
    choices: [
      { id: 'align_chart', label: '📄 星图共鸣', requires: (s) => s.inventory.includes('star_chart') && !s.flags.moon_blessed },
      { id: 'dive_shrine', label: '🤿 潜入沉殿', requires: (s) => s.flags.moon_blessed },
      { id: 'back_crystal', label: '↩️ 返回晶洞' },
    ],
  },

  sunken_shrine: {
    id: 'sunken_shrine',
    text: T([
      '🛕 **水下沉殿**',
      '',
      '三证石台：月华、星图、泉心印记。缺一则门不开。',
    ]),
    choices: [
      { id: 'ritual_star_keeper', label: '✨ 完成星守仪式', requires: (s) => s.inventory.includes('moon_shard') && s.inventory.includes('star_chart') && s.flags.spirit_met },
      { id: 'back_moon_pool', label: '↩️ 浮上水面' },
    ],
  },

  observatory: {
    id: 'observatory',
    text: T([
      '🔭 **星象台**',
      '',
      '铜制浑天仪缺损。可校准罗盘。',
    ]),
    choices: [
      { id: 'craft_compass', label: '🧭 校准罗盘', requires: (s) => !s.inventory.includes('compass') },
      { id: 'back_tower', label: '↩️ 下塔' },
    ],
  },

  sealed_gates: {
    id: 'sealed_gates',
    text: T([
      '🚪 **回音巨门**',
      '',
      '铃、罗盘、钥三缺一时铭文闪烁。门后是封印内庭捷径。',
    ]),
    choices: [
      { id: 'open_gates', label: '🔓 开启巨门', requires: (s) => s.inventory.includes('spirit_bell') && s.inventory.includes('compass') && s.inventory.includes('key') },
      { id: 'back_crypt', label: '↩️ 返回岔口' },
    ],
  },

  vault: {
    id: 'vault',
    text: (s) => T([
      '🔐 **封印密室**',
      '',
      '三雕像：光、影、门。',
      s.flags.knows_sequence ? '顺序：光 → 影 → 门。' : '顺序未知。',
    ]),
    choices: [
      { id: 'seq_light_shadow_door', label: '光→影→门', style: 'primary' },
      { id: 'seq_door_light_shadow', label: '门→光→影' },
      { id: 'seq_shadow_door_light', label: '影→门→光' },
      { id: 'back_crypt', label: '↩️ 返回岔口' },
    ],
  },

  vault_open: {
    id: 'vault_open',
    text: (s) => T([
      '✨ **封印已解**',
      '',
      s.flags.amulet_upgraded ? '升华护符引路，王座厅近在咫尺。' : '螺旋阶梯通向王座厅。',
    ]),
    choices: [
      { id: 'descend_throne', label: '⬇️ 王座厅' },
      { id: 'take_treasure_now', label: '💰 取宝离开' },
      { id: 'back_crypt', label: '↩️ 返回岔口' },
    ],
  },

  throne_room: {
    id: 'throne_room',
    text: (s) => {
      const ready = s.flags.whisper_lore && s.flags.amulet_upgraded && s.flags.spirit_met;
      return T([
        '👑 **精灵王座厅**',
        '',
        ready ? '三证齐聚，王座虚影恭迎守忆者。' : '王座冷光闪烁，贸然落座恐遭反噬。',
      ]);
    },
    choices: [
      {
        id: 'ascend',
        label: '✨ 星辉归位',
        style: 'primary',
        requires: (s) => s.flags.whisper_lore && s.flags.amulet_upgraded && s.flags.spirit_met && s.inventory.includes('scroll'),
      },
      { id: 'ascend_mask', label: '🎭 面具加冕', requires: (s) => s.inventory.includes('masquerade_mask') },
      { id: 'claim_crown', label: '👑 坐上王座', style: 'danger' },
      { id: 'retreat_throne', label: '🏃 取宝离开' },
    ],
  },

  // —— 终局 ——
  treasure: { id: 'treasure', terminal: true, text: T(['🏆 **遗迹宝藏**', '', '琥珀星光入袋，你成为传说。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  ascension: { id: 'ascension', terminal: true, text: T(['🌟 **星辉归位**', '', '你成为守忆者，历史因你而不朽。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  wisdom: { id: 'wisdom', terminal: true, text: T(['📜 **智者归途**', '', '你携记忆离去，无宝亦足。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  curse: { id: 'curse', terminal: true, text: T(['☠️ **贪婪代价**', '', '王座吞噬了你。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  escape: { id: 'escape', terminal: true, text: T(['🌅 **生还**', '', '遗迹坍塌，你活着出来。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  defeat: { id: 'defeat', terminal: true, text: T(['💀 **陨落**', '', '秘境再添无名骸骨。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  coward: { id: 'coward', terminal: true, text: T(['🏠 **怯懦归途**', '', '你从未入门。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  hermit: { id: 'hermit', terminal: true, text: T(['🌳 **庭院隐者**', '', '你在古树下定居，与遗迹共生。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  redemption: { id: 'redemption', terminal: true, text: T(['🕊️ **幽魂解脱**', '', '你渡魂过桥，获冥府祝福。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  drowned: { id: 'drowned', terminal: true, text: T(['🌊 **寒水沉眠**', '', '积水厅吞没意识。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  spider: { id: 'spider', terminal: true, text: T(['🕷️ **茧中亡魂**', '', '巨蛛将你制成茧。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  labyrinth: { id: 'labyrinth', terminal: true, text: T(['🌑 **迷宫迷失**', '', '暗影吞没方向感。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  star_keeper: { id: 'star_keeper', terminal: true, text: T(['🌙 **星守誓约**', '', '你镇守月池，成为精灵最后的灯塔。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  mask_king: { id: 'mask_king', terminal: true, text: T(['🎭 **面具之王**', '', '面具与王座融合，你统治空城。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
  merchant: { id: 'merchant', terminal: true, text: T(['💰 **行商结局**', '', '你满载银币离开，遗迹不过集市。']), choices: [{ id: 'restart', label: '🔄 再玩一次', style: 'primary' }] },
};

export function countScenes(): { total: number; playable: number; terminals: number } {
  const all = Object.values(SCENES);
  const terminals = all.filter((s) => s.terminal).length;
  return { total: all.length, playable: all.length - terminals, terminals };
}
