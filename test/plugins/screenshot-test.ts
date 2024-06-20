import { Plugin } from 'zhin';
import fs from 'fs';
import '@zhinjs/plugin-screenshot';
import path from 'path';
const screenshotTest = new Plugin('screenshot');
screenshotTest.required('renderVue');
screenshotTest.mounted(async () => {
  const result = await screenshotTest.renderVue(path.join(__dirname, 'Test.vue'), {
    props: {
      who: '张三',
    },
    encoding: 'binary',
  });
  fs.writeFileSync(path.join(__dirname, 'test.jpg'), result);
});
export default screenshotTest;
