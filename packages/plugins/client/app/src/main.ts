import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import { createPinia } from 'pinia';
/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';
import { router, useCommonStore } from '@zhinjs/client';
import App from './App.vue';
const pinia = createPinia();
const wsUrl = `${window.location.protocol.replace(/^http?/, 'ws')}${window.location.host}/server`;
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

router.addRoute({
  path: '/',
  name: 'Zhin',
  component: () => import('./pages/$.vue'),
  children: [
    {
      path: '',
      name: '首页',
      component: () => import('./pages/dashboard.vue'),
    },
  ],
});
const app = createApp(App);
app.use(pinia).use(router).use(IonicVue);
app.config.globalProperties.$ws = ws;
app.mount('#app');
