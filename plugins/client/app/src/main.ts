import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from "primevue/config";
import { addPage, router, useCommonStore } from '@zhin.js/client';
import { updateAllData, DataService } from './services/api';
import App from './App.vue';
// 引入通用样式
import './styles/common.css';

// 全局暴露数据管理方法，供外部模块使用
declare global {
    interface Window {
        ZhinDataAPI: {
            updateAllData: () => Promise<void>
            getSystemStatus: () => Promise<any>
            getPlugins: () => Promise<any>
            getAdapters: () => Promise<any>
            reloadPlugin: (pluginName: string) => Promise<any>
            sendMessage: (payload: any) => Promise<any>
        }
        ZhinStore: {
            getCommonStore: () => any
        }
    }
}

const pinia = createPinia();

// 暴露全局API，供外部模块和适配器使用
window.ZhinDataAPI = {
    updateAllData: () => updateAllData().then(() => Promise.resolve()),
    getSystemStatus: DataService.getSystemStatus,
    getPlugins: DataService.getPlugins,
    getAdapters: DataService.getAdapters,
    reloadPlugin: DataService.reloadPlugin,
    sendMessage: DataService.sendMessage,
}

// 暴露全局Store访问器
window.ZhinStore = {
    getCommonStore: () => useCommonStore(pinia)
}

// 🌍 Zhin 全局API已暴露到 window 对象

const wsUrl = `${window.location.protocol.replace(/^http?/, 'ws')}${window.location.host}/server`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
    // WebSocket连接已建立
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
        case 'init-data':
            // 初始化时获取数据
            // 🚀 收到初始化数据通知
            updateAllData();
            break;
        case 'data-update':
            // 收到更新通知时获取最新数据
            // 🔄 收到数据更新通知
            updateAllData();
            break;
        default:
            return;
    }
};

ws.onclose = () => {
    // WebSocket连接已关闭
};
const app = createApp(App);
app.use(pinia).use(router).use(PrimeVue, {
    // 临时移除主题配置以修复类型错误
});
app.config.globalProperties.$ws = ws;
// 注册主布局路由
router.addRoute({
    path: '/',
    name: 'Zhin',
    component: () => import('./pages/$.vue'),
});

// 注册所有内置页面（addPage 会自动添加路由和菜单）
addPage({
    parentName: 'Zhin',
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('./pages/dashboard.vue'),
});

addPage({
    parentName: 'Zhin',
    path: '/system/status',
    name: 'Status',
    component: () => import('./pages/system/status.vue'),
});

addPage({
    parentName: 'Zhin',
    path: '/contexts/overview',
    name: 'Overview',
    component: () => import('./pages/contexts/overview.vue'),
});



addPage({
    parentName: 'Zhin',
    path: '/plugins/installed',
    name: 'Installed',
    component: () => import('./pages/plugins/installed.vue'),
});

// 📝 所有内置页面已通过 addPage 注册

app.mount('#app');
