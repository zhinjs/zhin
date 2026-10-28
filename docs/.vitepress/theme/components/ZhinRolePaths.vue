<script setup lang="ts">
interface RolePath {
  eyebrow: string
  title: string
  description: string
  href: string
  action: string
}

withDefaults(defineProps<{
  heading?: string
  intro?: string
  items?: RolePath[]
}>(), {
  heading: '你想做什么？',
  intro: '不需要先读完整套架构。挑一个眼下的目标，每条路径都能在一次会话内走完。',
  items: () => [
    { eyebrow: 'RUN', title: '跑起第一个 Bot', description: '不需要平台账号和模型 Key，在浏览器 Sandbox 里收到第一条回复。', href: '/getting-started/', action: '开始首跑' },
    { eyebrow: 'BUILD', title: '写自己的功能', description: '命令、关键词回复、定时推送、AI 工具——把文件放进约定目录就生效。', href: '/getting-started/first-plugin', action: '写第一个插件' },
    { eyebrow: 'SHIP', title: '接平台并上线', description: '选适配器接入 QQ / 微信 / Discord 等，再完成部署、监控与升级。', href: '/adapters/', action: '选择平台' },
    { eyebrow: 'OPERATE', title: '不写代码运营 Bot', description: '运营 / 群主：在 Console 里看消息、改配置、装功能、管群欢迎与公告审批。', href: '/customer/', action: '运营与群管指南' },
  ],
})
</script>

<template>
  <section class="role-paths" aria-labelledby="role-paths-title">
    <div class="role-paths__head">
      <h2 id="role-paths-title">{{ heading }}</h2>
      <p>{{ intro }}</p>
    </div>
    <div class="role-paths__grid">
      <a v-for="item in items" :key="item.title" :href="item.href" class="role-path">
        <span class="role-path__eyebrow">{{ item.eyebrow }}</span>
        <strong>{{ item.title }}</strong>
        <p>{{ item.description }}</p>
        <span class="role-path__action">{{ item.action }} <span aria-hidden="true">→</span></span>
      </a>
    </div>
  </section>
</template>

<style scoped>
.role-paths {
  max-width: 1080px;
  margin: 0 auto;
  padding: 64px 24px 0;
}

.role-paths__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.role-paths__head h2 {
  margin: 0;
  border: 0;
  color: var(--zhin-ink);
  font-size: clamp(24px, 3vw, 34px);
  letter-spacing: -0.03em;
}

.role-paths__head p {
  max-width: 420px;
  margin: 0;
  color: var(--zhin-ink-2);
  line-height: 1.7;
}

.role-paths__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--zhin-line);
  border-radius: 14px;
  overflow: hidden;
}

.role-path {
  display: flex;
  min-height: 230px;
  padding: 24px;
  flex-direction: column;
  color: inherit;
  text-decoration: none;
  background: var(--vp-c-bg);
  border-right: 1px solid var(--zhin-line);
  transition: background 160ms ease, transform 160ms ease;
}

.role-path:last-child { border-right: 0; }
.role-path:hover { background: var(--vp-c-bg-soft); transform: translateY(-2px); }
.role-path:focus-visible { outline: 3px solid var(--vp-c-brand); outline-offset: -3px; }

.role-path__eyebrow {
  margin-bottom: 28px;
  color: var(--vp-c-brand);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.role-path strong { color: var(--zhin-ink); font-size: 17px; }
.role-path p { margin: 10px 0 24px; color: var(--zhin-ink-2); font-size: 14px; line-height: 1.7; }
.role-path__action { margin-top: auto; color: var(--vp-c-brand-dark); font-size: 13px; font-weight: 700; }
.dark .role-path__action { color: var(--vp-c-brand-light); }

@media (max-width: 900px) {
  .role-paths__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .role-path:nth-child(2) { border-right: 0; }
  .role-path:nth-child(-n + 2) { border-bottom: 1px solid var(--zhin-line); }
}

@media (max-width: 600px) {
  .role-paths__head { align-items: start; flex-direction: column; }
  .role-paths__grid { grid-template-columns: 1fr; }
  .role-path { min-height: 0; border-right: 0; border-bottom: 1px solid var(--zhin-line); }
  .role-path:nth-child(3) { border-bottom: 1px solid var(--zhin-line); }
  .role-path:last-child { border-bottom: 0; }
  .role-path__eyebrow { margin-bottom: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .role-path { transition: none; }
}
</style>
