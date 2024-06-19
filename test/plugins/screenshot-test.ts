import { Plugin } from 'zhin';
import '@zhinjs/plugin-screenshot';
import path from 'path';
const screenshotTest = new Plugin('screenshot');
screenshotTest.required('renderVue');
screenshotTest.mounted(async () => {
  const result = await screenshotTest.renderVue(path.join(__dirname, 'Test.vue'), {
    encoding: 'base64',
  });
  console.log(result);
});
export default screenshotTest;
