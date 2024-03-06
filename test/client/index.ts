import { addPage } from '@zhinjs/client';
import Test from './test.vue';
addPage({
  parentName: 'Admin',
  icon: 'edit',
  path: '/test',
  name: '111233',
  children: [],
  component: Test,
});
