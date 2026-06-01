import type { PluginRegisterHostApi } from '@zhin.js/console-types';
import NapCatManagement from './NapCatManagement';

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: '/console/napcat',
    name: 'NapCat管理',
    element: api.React.createElement(NapCatManagement, { hostReact: api.React }),
  });
  api.addTool({ id: 'napcat', name: 'NapCat', path: '/console/napcat' });
}
