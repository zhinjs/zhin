import { createRouter, createWebHistory } from '@ionic/vue-router';
import { useCommonStore } from './store';
import { MenuWithComponent, ToolInfo } from './types';
export const router = createRouter({
  history: createWebHistory(),
  routes: [],
});

router.beforeEach(async (to, from, next) => {
  const commonStore = useCommonStore();
  if (!commonStore.initialized) {
    await commonStore.initial;
    return next({ ...to, replace: true });
  }
  return next();
});
export function addPage(menu: MenuWithComponent) {
  if (menu.parentName) {
    router.addRoute(menu.parentName, {
      path: menu.path,
      name: menu.name,
      component: menu.component,
      children: [],
    });
  } else {
    router.addRoute({
      path: menu.path,
      name: menu.name,
      component: menu.component,
      children: [],
    });
  }
  useCommonStore().addData({
    key: 'menus',
    value: menu,
  });
  return () => router.removeRoute(menu.name);
}
export function addTool(tool: ToolInfo) {
  useCommonStore().addData({
    key: 'tools',
    value: tool,
  });
}
