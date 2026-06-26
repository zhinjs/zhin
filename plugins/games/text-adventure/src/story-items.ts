/** 15 种可收集道具 */
export const ITEM_LABELS: Record<string, string> = {
  torch: '火把',
  key: '锈蚀钥匙',
  gem: '幽蓝宝石',
  herb: '荧光草药',
  scroll: '残破卷轴',
  amulet: '精灵护符',
  silver_coin: '古银币',
  rusted_blade: '生锈短剑',
  moon_shard: '月华碎片',
  elixir: '治愈灵药',
  compass: '星象罗盘',
  spirit_bell: '回音铃',
  elf_feather: '银羽',
  masquerade_mask: '仪式面具',
  star_chart: '星图残页',
};

export const ITEM_IDS = Object.keys(ITEM_LABELS);

export function itemLabel(id: string): string {
  return ITEM_LABELS[id] ?? id;
}
