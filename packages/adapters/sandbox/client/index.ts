import { addPage } from '@zhinjs/client';
import Test from './test.vue';
addPage({
  parentName: 'Zhin',
  icon: 'edit',
  path: '/sandbox',
  name: '沙盒',
  children: [],
  component: Test,
});
