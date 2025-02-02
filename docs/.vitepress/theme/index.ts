import DefaultTheme from 'vitepress/theme';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import ChatHistory from './components/ChatHistory.vue';
import UserAvatar from './components/UserAvatar.vue';
import ChatMsg from './components/ChatMsg.vue';
import RenderMarkdown from './components/RenderMarkdown.vue';
import ComponentStore from './components/ComponentStore.vue';

export default {
  Layout: DefaultTheme.Layout,
  enhanceApp({ app }) {
    app.use(ElementPlus, {
      locale: zhCn,
      size: 'small',
    });
    // 注册所有图标
    for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
      app.component(key, component);
    }
    app.component('UserAvatar', UserAvatar);
    app.component('ChatMsg', ChatMsg);
    app.component('component-store', ComponentStore);
    app.component('render-markdown', RenderMarkdown);
    app.component('ChatHistory', ChatHistory);
  },
};
