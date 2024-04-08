import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import TestCmp from './test';
import { Plugin } from 'zhin';
const shot = new Plugin('shot');
shot.command('shot').action(async () => {
  const template = await renderToString(createSSRApp(TestCmp, { who: '张三' }));
  console.log(template);
});
export default shot;
