import { type Locale } from 'zhin.js/i18n';
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

const EN_ITEM_LABELS: Readonly<Record<string, string>> = {
  "torch": "Torch",
  "key": "Rusty key",
  "gem": "Blue gem",
  "herb": "Luminous herb",
  "scroll": "Torn scroll",
  "amulet": "Elven amulet",
  "silver_coin": "Ancient silver coin",
  "rusted_blade": "Rusty blade",
  "moon_shard": "Moon shard",
  "elixir": "Healing elixir",
  "compass": "Astral compass",
  "spirit_bell": "Echo bell",
  "elf_feather": "Silver feather",
  "masquerade_mask": "Ritual mask",
  "star_chart": "Star chart fragment"
};

export function itemLabel(id: string, locale: Locale = 'zh-CN'): string {
  return (locale === 'en' ? EN_ITEM_LABELS : ITEM_LABELS)[id] ?? id;
}
