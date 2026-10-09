import { defineCommand } from 'zhin.js/command';
import { Card, CardHeader } from '@zhin.js/components';

export default defineCommand({
  description: '直接返回 JSX',
  execute: () => <Card><CardHeader title={<strong>JSX ready</strong>} /><p>来自命令</p></Card>,
});
