import { Plugin, segment } from 'zhin';
import '@zhinjs/plugin-screenshot';
import Test from './Test.vue';
const screenshotTest = new Plugin('screenshot');
screenshotTest.waitServices('renderVue', app => {
  screenshotTest.command('shot').action(async () => {
    return segment.image(
      `base64://${await app.renderVue(Test, {
        props: {
          who: '张三',
        },
        encoding: 'base64',
      })}`,
    );
  });
});
export default screenshotTest;
