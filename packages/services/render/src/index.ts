import { defineComponent, h, createSSRApp } from 'vue';
import { Plugin } from 'zhin';
import { renderToString } from '@vue/server-renderer';
const shot = new Plugin('shot');
const cmp = defineComponent({
  name: 'App',
  props: {
    who: {
      type: String,
      default: '张三',
    },
  },
  setup(props) {
    return () => h('div', `Hello ${props.who}`);
  },
});

shot.command('shot').action(async () => {
  const template = await renderToString(createSSRApp(cmp, { who: '张三' }));
  console.log(template);
});
export default shot;
