/**
 * 平台适配器档位 SSOT（单一来源）。
 * 由 sync-adapter-docs / check-platform-tiers-ssot / 文档生成共享。
 *
 * 升档至 Platform Stable 须满足 ADR 0015 D3，并加入 run-stable-smoke 的 platform 批。
 * 当前诚实状态：仅 Sandbox 为 Stable；无 Platform Stable；其余 Advanced / Experimental。
 */

/** @typedef {'Stable' | 'PlatformStable' | 'Advanced' | 'Experimental'} AdapterTier */

/**
 * @type {Record<string, { tier: AdapterTier, label: string, packageName: string }>}
 */
export const ADAPTER_META = {
  sandbox: { tier: 'Stable', label: 'Sandbox', packageName: '@zhin.js/adapter-sandbox' },
  icqq: { tier: 'Advanced', label: 'ICQQ (QQ)', packageName: '@zhin.js/adapter-icqq' },
  qq: { tier: 'Advanced', label: 'QQ 官方', packageName: '@zhin.js/adapter-qq' },
  napcat: { tier: 'Experimental', label: 'NapCat', packageName: '@zhin.js/adapter-napcat' },
  onebot11: { tier: 'Advanced', label: 'OneBot v11', packageName: '@zhin.js/adapter-onebot11' },
  onebot12: { tier: 'Experimental', label: 'OneBot v12', packageName: '@zhin.js/adapter-onebot12' },
  milky: { tier: 'Experimental', label: 'Milky', packageName: '@zhin.js/adapter-milky' },
  kook: { tier: 'Advanced', label: 'KOOK', packageName: '@zhin.js/adapter-kook' },
  discord: { tier: 'Advanced', label: 'Discord', packageName: '@zhin.js/adapter-discord' },
  telegram: { tier: 'Advanced', label: 'Telegram', packageName: '@zhin.js/adapter-telegram' },
  slack: { tier: 'Advanced', label: 'Slack', packageName: '@zhin.js/adapter-slack' },
  dingtalk: { tier: 'Advanced', label: '钉钉', packageName: '@zhin.js/adapter-dingtalk' },
  lark: { tier: 'Advanced', label: '飞书', packageName: '@zhin.js/adapter-lark' },
  'wechat-mp': { tier: 'Advanced', label: '微信公众号', packageName: '@zhin.js/adapter-wechat-mp' },
  email: { tier: 'Experimental', label: 'Email', packageName: '@zhin.js/adapter-email' },
  github: { tier: 'Experimental', label: 'GitHub', packageName: '@zhin.js/adapter-github' },
  satori: { tier: 'Experimental', label: 'Satori', packageName: '@zhin.js/adapter-satori' },
  line: { tier: 'Experimental', label: 'LINE', packageName: '@zhin.js/adapter-line' },
  wecom: { tier: 'Experimental', label: '企业微信', packageName: '@zhin.js/adapter-wecom' },
  'weixin-ilink': { tier: 'Experimental', label: '微信 iLink', packageName: '@zhin.js/adapter-weixin-ilink' },
};

/** @type {Record<AdapterTier, number>} */
export const TIER_ORDER = {
  Stable: 0,
  PlatformStable: 1,
  Advanced: 2,
  Experimental: 3,
};

/** Frontmatter / docs 展示名（PlatformStable → Platform Stable） */
export function tierDisplayName(tier) {
  if (tier === 'PlatformStable') return 'Platform Stable';
  return tier;
}

/** sync-adapter-docs frontmatter 仅三档 Stable|Advanced|Experimental。
 * 产品 SSOT 的 PlatformStable 在 ADAPTER_META；frontmatter 映射为 Advanced，避免误标为 Stable。
 */
export function tierForFrontmatter(tier) {
  if (tier === 'PlatformStable') return 'Advanced';
  return tier;
}

/**
 * @param {AdapterTier} tier
 * @returns {string[]}
 */
export function slugsForTier(tier) {
  return Object.entries(ADAPTER_META)
    .filter(([, m]) => m.tier === tier)
    .sort((a, b) => a[1].label.localeCompare(b[1].label, 'zh'))
    .map(([slug]) => slug);
}
