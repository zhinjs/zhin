import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';
import { router, useCommonStore } from '@zhinjs/client';
import App from './App.vue';
const pinia = createPinia();
const wsUrl = `${window.location.protocol.startsWith('https?') ? 'wss://' : 'ws://'}${window.location.host}/server`;
const ws = new WebSocket(wsUrl);
ws.onopen = () => {
  console.log('connection to ' + wsUrl);
};
ws.onmessage = message => {
  const payload = JSON.parse(message.data || '{}');
  const commonStore = useCommonStore(pinia);
  switch (payload.type) {
    case 'sync':
      return commonStore.syncData(payload.data);
    case 'add':
      return commonStore.addData(payload.data);
    case 'delete':
      return commonStore.deleteData(payload.data);
    default:
      return;
  }
};
ws.onclose = () => {
  console.log('connection closed');
};
const app = createApp(App).use(pinia).use(router).use(ElementPlus);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.config.globalProperties.$ws = ws;
app.mount('#app');
