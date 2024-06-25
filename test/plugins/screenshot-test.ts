import { Plugin, segment } from 'zhin';
import fs from 'fs';
import '@zhinjs/plugin-screenshot';
import path from 'path';
const screenshotTest = new Plugin('screenshot');
screenshotTest.required('renderVue');
screenshotTest.mounted(async () => {
  screenshotTest.command('shot').action(async () => {
    return segment.image(
      `base64://${await screenshotTest.renderVue(path.join(__dirname, 'Test.vue'), {
        props: {
          who: '张三',
        },
        files: [path.join(__dirname, 'components')],
        encoding: 'base64',
      })}`,
    );
  });
});
export default screenshotTest;
