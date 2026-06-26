import { ITEM_IDS } from './story-items.js';
import { endingIds, playableSceneIds } from './story-catalog.js';

export interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  description: string;
  hidden?: boolean;
}

export interface AchievementContext {
  visited: Set<string>;
  endings: Set<string>;
  itemsFound: Set<string>;
  runsCompleted: number;
  bestStepCount: number;
  lastRun?: {
    stepCount: number;
    inventory: string[];
    endingId: string;
  };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_footprint', icon: '👣', title: '初探者', description: '累计探索 5 个区域' },
  { id: 'cartographer', icon: '🗺️', title: '制图师', description: '解锁半数区域（50%+）' },
  { id: 'master_explorer', icon: '🧭', title: '全图行者', description: '解锁全部可探索区域' },
  { id: 'ending_hunter', icon: '🎬', title: '结局猎人', description: '见证 3 种不同结局' },
  { id: 'ending_collector', icon: '📚', title: '结局收藏家', description: '见证 8 种不同结局' },
  { id: 'completionist', icon: '👑', title: '秘境通晓者', description: '见证全部 15 种结局' },
  { id: 'star_ascendant', icon: '🌟', title: '星辉守忆', description: '达成「星辉归位」结局' },
  { id: 'moon_guardian', icon: '🌙', title: '月池星守', description: '达成「星守誓约」结局' },
  { id: 'mask_monarch', icon: '🎭', title: '面具之王', description: '达成「面具之王」结局' },
  { id: 'item_hoarder', icon: '🎒', title: '拾荒大师', description: '生涯累计发现 10 种道具' },
  { id: 'full_satchel', icon: '💎', title: '万象行囊', description: '生涯集齐全部 15 种道具' },
  { id: 'marathon_runner', icon: '🏃', title: '马拉松探险', description: '单局步数达到 50+' },
  { id: 'veteran', icon: '⚔️', title: '遗迹老兵', description: '完成 5 局冒险' },
  { id: 'whisper_listener', icon: '👂', title: '低语聆听者', description: '进入低语画廊' },
  { id: 'deep_diver', icon: '🌊', title: '沉殿潜行者', description: '抵达水下沉殿' },
];

const PLAYABLE_TOTAL = playableSceneIds().length;
const ENDING_TOTAL = endingIds().length;
const HALF_REGIONS = Math.ceil(PLAYABLE_TOTAL / 2);

function checks(): Record<string, (ctx: AchievementContext) => boolean> {
  return {
    first_footprint: (ctx) => ctx.visited.size >= 5,
    cartographer: (ctx) => ctx.visited.size >= HALF_REGIONS,
    master_explorer: (ctx) => ctx.visited.size >= PLAYABLE_TOTAL,
    ending_hunter: (ctx) => ctx.endings.size >= 3,
    ending_collector: (ctx) => ctx.endings.size >= 8,
    completionist: (ctx) => ctx.endings.size >= ENDING_TOTAL,
    star_ascendant: (ctx) => ctx.endings.has('ascension'),
    moon_guardian: (ctx) => ctx.endings.has('star_keeper'),
    mask_monarch: (ctx) => ctx.endings.has('mask_king'),
    item_hoarder: (ctx) => ctx.itemsFound.size >= 10,
    full_satchel: (ctx) => ITEM_IDS.every((id) => ctx.itemsFound.has(id)),
    marathon_runner: (ctx) => (ctx.lastRun?.stepCount ?? ctx.bestStepCount) >= 50,
    veteran: (ctx) => ctx.runsCompleted >= 5,
    whisper_listener: (ctx) => ctx.visited.has('whisper_gallery'),
    deep_diver: (ctx) => ctx.visited.has('sunken_shrine'),
  };
}

export function evaluateAchievements(
  unlocked: string[],
  ctx: AchievementContext,
): string[] {
  const have = new Set(unlocked);
  const run = checks();
  const newly: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (have.has(def.id)) continue;
    if (run[def.id]?.(ctx)) {
      have.add(def.id);
      newly.push(def.id);
    }
  }
  return newly;
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function totalAchievements(): number {
  return ACHIEVEMENTS.length;
}
