import { addPage } from '@zhinjs/client';
import Test from './test.vue';
addPage({
  parentName: 'Zhin',
  icon: 'edit',
  path: '/test',
  name: '测试',
  children: [],
  component: Test,
});
