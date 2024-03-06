import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import 'element-plus/dist/index.css';
import { router } from '@zhinjs/client';
import App from './App.vue';
const pinia = createPinia();
import { useCommonStore } from '@/store';
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
app.config.globalProperties.$ws = ws;
app.mount('#app');
