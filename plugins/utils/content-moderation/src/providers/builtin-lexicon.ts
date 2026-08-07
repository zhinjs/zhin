import type { Severity } from '../types.js';

export type LexiconSeverity = Exclude<Severity, 'pass'>;

export interface LexiconEntry {
  readonly word: string;
  readonly severity: LexiconSeverity;
}

/**
 * Built-in graded lexicon for IM bots (starter set).
 * Users can extend / override via `words` / `wordFiles`; same word keeps the
 * higher severity when merging.
 */
export const BUILTIN_LEXICON: readonly LexiconEntry[] = Object.freeze([
  // —— low：轻度不当 / 骚扰语气 ——
  entry('脑残', 'low'),
  entry('智障', 'low'),
  entry('废物', 'low'),
  entry('垃圾人', 'low'),
  entry('滚蛋', 'low'),
  entry('去死', 'low'),
  entry('找死', 'low'),
  entry('闭嘴', 'low'),
  entry('恶心', 'low'),
  entry('变态', 'low'),

  // —— medium：辱骂 / 粗口 ——
  entry('傻逼', 'medium'),
  entry('傻B', 'medium'),
  entry('傻b', 'medium'),
  entry('傻叉', 'medium'),
  entry('操逼', 'medium'),
  entry('草泥马', 'medium'),
  entry('妈的', 'medium'),
  entry('他妈的', 'medium'),
  entry('你妈的', 'medium'),
  entry('卧槽', 'medium'),
  entry('日你', 'medium'),
  entry('操你', 'medium'),
  entry('操他', 'medium'),
  entry('狗日的', 'medium'),
  entry('混蛋', 'medium'),
  entry('王八蛋', 'medium'),
  entry('白痴', 'medium'),
  entry('去死吧', 'medium'),

  // —— high：色情 / 引流诈骗常见话术 ——
  entry('约炮', 'high'),
  entry('裸聊', 'high'),
  entry('色情', 'high'),
  entry('黄色网站', 'high'),
  entry('看片加', 'high'),
  entry('援交', 'high'),
  entry('包养', 'high'),
  entry('上门服务', 'high'),
  entry('加微信领', 'high'),
  entry('刷单返利', 'high'),
  entry('刷单赚钱', 'high'),
  entry('日赚千元', 'high'),
  entry('稳赚不赔', 'high'),
  entry('内幕消息', 'high'),
  entry('代开发票', 'high'),
  entry('办假证', 'high'),
  entry('假钞', 'high'),
  entry('色情服务', 'high'),
  entry('一夜情', 'high'),

  // —— high：中国政治敏感（常见审查词，可按业务在配置中覆盖/关闭内置）——
  entry('台独', 'high'),
  entry('藏独', 'high'),
  entry('疆独', 'high'),
  entry('港独', 'high'),
  entry('分裂国家', 'high'),
  entry('民族分裂', 'high'),
  entry('法轮功', 'high'),
  entry('法轮大法', 'high'),
  entry('六四事件', 'high'),
  entry('六四屠城', 'high'),
  entry('天安门事件', 'high'),
  entry('坦克人', 'high'),
  entry('学潮动乱', 'high'),
  entry('政治风波', 'high'),
  entry('打倒共产党', 'high'),
  entry('推翻共产党', 'high'),
  entry('颠覆国家政权', 'high'),
  entry('占中运动', 'high'),
  entry('反送中', 'high'),
  entry('香港独立', 'high'),
  entry('台湾独立', 'high'),
  entry('西藏独立', 'high'),
  entry('新疆独立', 'high'),
  entry('东突厥斯坦', 'high'),
  entry('民运人士', 'high'),
  entry('零八宪章', 'high'),
  entry('煽动颠覆', 'high'),
  entry('颜色革命', 'high'),
  entry('大跃进饿死', 'high'),
  entry('文革迫害', 'high'),

  // —— critical：毒品 / 极端违法 / 煽动暴力颠覆 ——
  entry('冰毒', 'critical'),
  entry('海洛因', 'critical'),
  entry('可卡因', 'critical'),
  entry('大麻走私', 'critical'),
  entry('售卖枪支', 'critical'),
  entry('买卖枪支', 'critical'),
  entry('制毒', 'critical'),
  entry('贩毒', 'critical'),
  entry('炸药制作', 'critical'),
  entry('儿童色情', 'critical'),
  entry('幼女援交', 'critical'),
  entry('武装暴动', 'critical'),
  entry('暴力推翻政权', 'critical'),
  entry('刺杀国家领导人', 'critical'),
]);

function entry(word: string, severity: LexiconSeverity): LexiconEntry {
  return Object.freeze({ word, severity });
}

/** Merge entries; duplicate words keep the higher severity. */
export function mergeLexiconEntries(
  ...lists: Array<readonly LexiconEntry[] | undefined>
): readonly LexiconEntry[] {
  const map = new Map<string, LexiconSeverity>();
  const rank: Record<LexiconSeverity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const word = item.word.trim();
      if (!word) continue;
      const prev = map.get(word);
      if (!prev || rank[item.severity] > rank[prev]) {
        map.set(word, item.severity);
      }
    }
  }
  return Object.freeze(
    [...map.entries()]
      .map(([word, severity]) => Object.freeze({ word, severity }))
      .sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word)),
  );
}
