import { Plugin, segment } from 'zhin';
import '@zhinjs/plugin-screenshot';
import Test from './Test.vue';
// console.log(Test);
const screenshotTest = new Plugin('screenshot');
screenshotTest.required('renderVue');
screenshotTest.command('shot').action(async () => {
  return segment.image(
    `base64://${await screenshotTest.renderVue(Test, {
      props: {
        who: '张三',
      },
      encoding: 'base64',
    })}`,
  );
});
export default screenshotTest;
