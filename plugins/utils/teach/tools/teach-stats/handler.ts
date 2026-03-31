import { getQA } from '../../src/index.js';

export default async function teachStats(): Promise<string> {
  const QA = getQA();
  if (!QA) return '问答数据库尚未就绪';

  const allItems: any[] = await QA.select();
  if (allItems.length === 0) return '问答库为空，还没有任何问答对';

  const globalCount = allItems.filter((i: any) => i.context_type === 'global').length;
  const groupCount = allItems.filter((i: any) => i.context_type === 'group').length;
  const regexCount = allItems.filter((i: any) => i.is_regex).length;
  const exactCount = allItems.length - regexCount;
  const totalHits = allItems.reduce((sum: number, i: any) => sum + (i.hit_count || 0), 0);

  const topItems = [...allItems]
    .sort((a: any, b: any) => (b.hit_count || 0) - (a.hit_count || 0))
    .slice(0, 5);

  const topLines = topItems.map((item: any, idx: number) => {
    const q = item.is_regex ? `/${item.question}/` : item.question;
    return `  ${idx + 1}. ${q} → ${item.answer}  (${item.hit_count || 0}次)`;
  });

  return [
    '📊 问答库统计',
    '',
    `总数: ${allItems.length} 条`,
    `  精确匹配: ${exactCount} 条`,
    `  正则匹配: ${regexCount} 条`,
    `  全局问答: ${globalCount} 条`,
    `  群聊专属: ${groupCount} 条`,
    `累计命中: ${totalHits} 次`,
    '',
    '🔥 热门 Top 5:',
    ...topLines,
  ].join('\n');
}
