/**
 * IM 内省指令格式化（/cmd、/endpoints 等）
 */

export interface EndpointRow {
  adapter: string;
  name: string;
  online: boolean;
}

export function formatEndpointsList(endpoints: EndpointRow[]): string {
  if (endpoints.length === 0) return '🤖 暂无 Endpoint 实例';
  const lines = ['🤖 Endpoint 列表 (' + endpoints.length + ')', ''];
  for (const b of [...endpoints].sort((a, c) => a.adapter.localeCompare(c.adapter) || a.name.localeCompare(c.name))) {
    const mark = b.online ? '● online' : '○ offline';
    lines.push(`  ${mark}  ${b.adapter}/${b.name}`);
  }
  return lines.join('\n');
}

export function endpointHelpText(): string {
  return [
    'Endpoint 运行时管理：',
    '',
    '  /endpoint add [adapter]   — 添加 endpoint（adapter 交互或 schema 向导）',
    '  /endpoint remove <adapter> <name>',
    '  /endpoint edit <adapter> <name>',
    '  /endpoint start <adapter> <name>',
    '  /endpoint stop <adapter> <name>',
    '  /endpoint cancel          — 取消进行中的添加/绑定',
    '  /endpoint sync            — 将内存 endpoint 写回 zhin.config',
    '  /endpoint help',
    '  /endpoints                — 查看运行时在线状态',
  ].join('\n');
}
