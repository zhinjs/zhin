import DefaultTheme from "vitepress/theme";
import ChatHistory from './components/ChatHistory.vue';
import UserAvatar from './components/UserAvatar.vue';
import ChatMsg from './components/ChatMsg.vue';

export default {
    Layout:DefaultTheme.Layout,
    NotFound:DefaultTheme.NotFound,
    enhanceApp({ app }) {
        app.component('UserAvatar', UserAvatar);
        app.component("ChatMsg", ChatMsg);
        app.component("ChatHistory", ChatHistory);
    }
}