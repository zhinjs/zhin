import { SCENES } from './story-scenes.js';

/** 区域中文名（用于地图 / 成就展示） */
export const REGION_LABELS: Record<string, string> = {
  start: '秘境入口',
  rubble: '碎石廊',
  watchtower: '瞭望石塔',
  observatory: '星象台',
  vine_path: '秘径',
  corridor: '幽暗走廊',
  mural_room: '铭文壁画',
  whisper_gallery: '低语画廊',
  spring: '精灵泉',
  flooded_hall: '积水厅',
  bell_tower: '钟楼',
  garden: '古庭院',
  greenhouse: '遗迹温室',
  library: '尘封书库',
  ember_forge: '锻炉间',
  market_ruins: '废墟市集',
  ghost_bridge: '冥河石桥',
  crystal_cave: '晶洞',
  moon_pool: '月池',
  sunken_shrine: '水下沉殿',
  depths: '墓穴岔口',
  crypt_entry: '墓穴入口',
  catacombs: '骸骨甬道',
  ossuary: '龛室',
  prison_cell: '囚室',
  spider_nest: '蛛巢',
  shadow_maze: '暗影迷宫',
  sealed_gates: '封印密室',
  vault: '宝藏前厅',
  vault_open: '宝库',
  throne_room: '王座厅',
};

export const ENDING_LABELS: Record<string, string> = {
  treasure: '遗迹宝藏',
  ascension: '星辉归位',
  wisdom: '智者归途',
  curse: '贪婪代价',
  escape: '生还',
  defeat: '陨落',
  coward: '怯懦归途',
  hermit: '庭院隐者',
  redemption: '幽魂解脱',
  drowned: '寒水沉眠',
  spider: '茧中亡魂',
  labyrinth: '迷宫迷失',
  star_keeper: '星守誓约',
  mask_king: '面具之王',
  merchant: '行商结局',
};

/** 地图分区（便于 adv map 分组展示） */
export const MAP_ZONES: Array<{ name: string; sceneIds: string[] }> = [
  {
    name: '入口与塔',
    sceneIds: ['start', 'rubble', 'watchtower', 'observatory', 'vine_path'],
  },
  {
    name: '主廊与泉',
    sceneIds: ['corridor', 'mural_room', 'whisper_gallery', 'spring', 'flooded_hall', 'bell_tower'],
  },
  {
    name: '庭院书库',
    sceneIds: ['garden', 'greenhouse', 'library', 'ember_forge'],
  },
  {
    name: '冥域水线',
    sceneIds: ['market_ruins', 'ghost_bridge', 'crystal_cave', 'moon_pool', 'sunken_shrine'],
  },
  {
    name: '墓穴深处',
    sceneIds: [
      'depths',
      'crypt_entry',
      'catacombs',
      'ossuary',
      'prison_cell',
      'spider_nest',
      'shadow_maze',
      'sealed_gates',
      'vault',
      'vault_open',
      'throne_room',
    ],
  },
];

export function playableSceneIds(): string[] {
  return Object.values(SCENES)
    .filter((s) => !s.terminal)
    .map((s) => s.id);
}

export function endingIds(): string[] {
  return Object.values(SCENES)
    .filter((s) => s.terminal)
    .map((s) => s.id);
}

export function regionLabel(id: string): string {
  return REGION_LABELS[id] ?? ENDING_LABELS[id] ?? id;
}

export function endingLabel(id: string): string {
  return ENDING_LABELS[id] ?? id;
}
