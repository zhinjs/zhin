import { getQA } from '../../src/index.js';

export default async function teachQuery(args: { keyword?: string }): Promise<string> {
  const QA = getQA();
  if (!QA) return '问答数据库尚未就绪';

  const allItems: any[] = await QA.select();
  if (allItems.length === 0) return '问答库为空';

  let items = allItems;
  if (args.keyword) {
    const kw = args.keyword.toLowerCase();
    items = allItems.filter(
      (item: any) =>
        item.question.toLowerCase().includes(kw) ||
        item.answer.toLowerCase().includes(kw),
    );
  }

  if (items.length === 0) return `未找到包含「${args.keyword}」的问答`;

  const display = items.slice(0, 20);
  const lines = display.map((item: any) => {
    const prefix = item.is_regex ? '[正则]' : '[精确]';
    const scope = item.context_type === 'global' ? '全局' : `群${item.context_id}`;
    const q = item.is_regex ? `/${item.question}/` : item.question;
    return `${prefix}(${scope}) ${q} → ${item.answer}  (命中${item.hit_count || 0}次)`;
  });

  const header = args.keyword
    ? `搜索「${args.keyword}」结果 (${items.length} 条，显示前 ${display.length} 条)`
    : `全部问答 (${items.length} 条，显示前 ${display.length} 条)`;

  return `${header}\n${lines.join('\n')}`;
}
