/**
 * 敏感词库
 * 包含政治、暴力、色情、违禁品等敏感词汇
 */

// 政治敏感词
export const politicalWords = [
  '法轮功',
  '达赖',
  '台独',
  '藏独',
  '疆独',
  '港独',
  '民运',
  '民主化',
  '平反',
  '习近平',
  '反共',
  '专制',
  '独裁',
  '暴政',
  '集权',
  '一党专政',
  '多党制',
  '89事件',
  '64事件',
  '六四',
  '天安门事件',
  '学潮',
  '学运',
  '动乱',
  '暴乱',
  '骚乱',
  '游行',
  '示威',
  '抗议',
  '静坐',
  '绝食',
  '罢工',
  '罢课',
  '罢市',
  '维权',
  '上访',
  '请愿',
  '集会',
  '结社',
  '言论自由',
  '新闻自由',
  '人权',
  '民权',
  '宪政',
  '三权分立',
  '普选',
  '直选',
  '公投',
  '全民公决',
];

// 暴力恐怖词汇
export const violenceWords = [
  '恐怖主义',
  '恐怖分子',
  '恐怖袭击',
  '爆炸',
  '炸弹',
  '爆炸物',
  '自杀式袭击',
  '人肉炸弹',
  '生化武器',
  '核武器',
  '化学武器',
  '大规模杀伤',
  '屠杀',
  '杀人',
  '谋杀',
  '暗杀',
  '刺杀',
  '砍人',
  '持刀',
  '行凶',
  '伤害',
  '袭击',
  '攻击',
  '劫持',
  '绑架',
  '勒索',
  '敲诈',
  '威胁',
  '恐吓',
];

// 色情低俗词汇
export const pornWords = [
  '色情',
  '淫秽',
  '裸体',
  '裸照',
  '艳照',
  '偷拍',
  '走光',
  '露点',
  '激情',
  '成人',
  '黄色',
  '三级',
  'AV',
  'A片',
  '毛片',
  '黄片',
  'porn',
  'sex',
  '做爱',
  '性交',
  '嫖娼',
  '卖淫',
  '招嫖',
  '援交',
  '包养',
  '一夜情',
  '约炮',
];

// 违禁品词汇
export const prohibitedWords = [
  '毒品',
  '大麻',
  '海洛因',
  '冰毒',
  '摇头丸',
  '可卡因',
  '鸦片',
  '吗啡',
  'K粉',
  '麻古',
  '迷幻药',
  '致幻剂',
  '兴奋剂',
  '赌博',
  '赌场',
  '赌钱',
  '赌博网站',
  '网络赌博',
  '博彩',
  '六合彩',
  '赛马',
  '赌球',
  '枪支',
  '手枪',
  '步枪',
  '冲锋枪',
  '机关枪',
  '猎枪',
  '气枪',
  '火药',
  '子弹',
  '弹药',
  '军火',
];

// 诈骗相关词汇
export const fraudWords = [
  '网络诈骗',
  '电信诈骗',
  '刷单',
  '兼职刷单',
  '刷信誉',
  '套现',
  '信用卡套现',
  '花呗套现',
  '白条套现',
  '高利贷',
  '裸贷',
  '校园贷',
  '非法集资',
  '传销',
  '网络传销',
  '微商传销',
  '拉人头',
  '发展下线',
  '资金盘',
  '庞氏骗局',
  '投资理财骗局',
  '虚拟货币骗局',
];

// 其他违法违规词汇
export const illegalWords = [
  '翻墙',
  'VPN',
  '代理服务器',
  '科学上网',
  '梯子',
  '办证',
  '假证',
  '刻章',
  '假公章',
  '假学历',
  '假文凭',
  '代考',
  '替考',
  '考试作弊',
  '买卖答案',
  '论文代写',
  '代写论文',
  '学位代办',
  '文凭代办',
  '发票',
  '假发票',
  '代开发票',
  '增值税发票',
  '洗钱',
  '黑钱',
  '地下钱庄',
];

// 组合所有敏感词
export const allSensitiveWords = [
  ...politicalWords,
  ...violenceWords,
  ...pornWords,
  ...prohibitedWords,
  ...fraudWords,
  ...illegalWords,
];

/**
 * 创建敏感词正则表达式
 */
export function createSensitiveWordRegex(words: string[]): RegExp {
  // 转义特殊字符并创建正则
  const escapedWords = words.map(word => 
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  // 使用 'gi' 标志：g 用于全局匹配（match 方法），i 用于不区分大小写
  // 注意：对于 test() 方法，使用 'g' 会导致状态问题，但这里主要用于 match() 和 replace()
  return new RegExp(escapedWords.join('|'), 'gi');
}

/**
 * 敏感词检测选项
 */
export interface SensitiveFilterOptions {
  /** 是否启用政治敏感词过滤 */
  political?: boolean;
  /** 是否启用暴力恐怖词汇过滤 */
  violence?: boolean;
  /** 是否启用色情低俗词汇过滤 */
  porn?: boolean;
  /** 是否启用违禁品词汇过滤 */
  prohibited?: boolean;
  /** 是否启用诈骗相关词汇过滤 */
  fraud?: boolean;
  /** 是否启用其他违法违规词汇过滤 */
  illegal?: boolean;
  /** 自定义敏感词列表 */
  custom?: string[];
  /** 替换字符，默认为 * */
  replacement?: string;
  /** 是否直接拦截包含敏感词的消息 */
  block?: boolean;
}

/**
 * 获取启用的敏感词列表
 */
export function getEnabledWords(options: SensitiveFilterOptions): string[] {
  const words: string[] = [];
  
  if (options.political !== false) words.push(...politicalWords);
  if (options.violence !== false) words.push(...violenceWords);
  if (options.porn !== false) words.push(...pornWords);
  if (options.prohibited !== false) words.push(...prohibitedWords);
  if (options.fraud !== false) words.push(...fraudWords);
  if (options.illegal !== false) words.push(...illegalWords);
  if (options.custom && options.custom.length > 0) words.push(...options.custom);
  
  return words;
}
