<script setup lang="ts">
interface AudienceLink {
  text: string
  href: string
}

interface Audience {
  eyebrow: string
  title: string
  who: string
  description: string
  links: AudienceLink[]
  primary: AudienceLink
}

withDefaults(defineProps<{
  heading?: string
  intro?: string
  audiences?: Audience[]
}>(), {
  heading: '你是哪一类用户？',
  intro: '同一个 Bot，两种用法：运营在浏览器里管，开发者用代码扩展。先选你的身份，再挑具体目标。',
  audiences: () => [
    {
      eyebrow: 'CUSTOMER · 运营 / 群主',
      title: '不写代码，管好你的 Bot',
      who: '群主、社群运营、客服负责人',
      description: '在 Console 里看消息、改配置、装功能、管群欢迎与提醒；危险动作先审批再执行。',
      links: [
        { text: '连上 Console', href: '/customer/#connect-console' },
        { text: '不写代码改配置', href: '/customer/#no-code-config' },
        { text: '群管、公告与审批', href: '/customer/#group-ops' },
        { text: '在线 Demo', href: 'https://demo.zhin.dev' },
      ],
      primary: { text: '运营与群管指南', href: '/customer/' },
    },
    {
      eyebrow: 'DEVELOPER · 插件 / 适配器作者',
      title: '用 TypeScript 扩展 Bot',
      who: '写命令、插件、AI 工具、平台适配器的人',
      description: '一条命令建项目，功能 = 文件，保存即热重载；一套代码跑在 20+ 平台。',
      links: [
        { text: '快速开始', href: '/getting-started/' },
        { text: '第一个插件', href: '/getting-started/first-plugin' },
        { text: '适配器开发', href: '/authoring/adapters' },
        { text: 'AI 工具', href: '/authoring/agent-tools' },
      ],
      primary: { text: '开始开发', href: '/getting-started/' },
    },
  ],
})
</script>

<template>
  <section class="audience-split" aria-labelledby="audience-split-title">
    <div class="audience-split__head">
      <h2 id="audience-split-title">{{ heading }}</h2>
      <p>{{ intro }}</p>
    </div>
    <div class="audience-split__grid">
      <div v-for="item in audiences" :key="item.title" class="audience">
        <span class="audience__eyebrow">{{ item.eyebrow }}</span>
        <strong>{{ item.title }}</strong>
        <span class="audience__who">{{ item.who }}</span>
        <p>{{ item.description }}</p>
        <ul>
          <li v-for="link in item.links" :key="link.href"><a :href="link.href">{{ link.text }}</a></li>
        </ul>
        <a class="audience__action" :href="item.primary.href">{{ item.primary.text }} <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.audience-split {
  max-width: 1080px;
  margin: 0 auto;
  padding: 64px 24px 0;
}

.audience-split__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.audience-split__head h2 {
  margin: 0;
  border: 0;
  color: var(--zhin-ink);
  font-size: clamp(24px, 3vw, 34px);
  letter-spacing: -0.03em;
}

.audience-split__head p {
  max-width: 460px;
  margin: 0;
  color: var(--zhin-ink-2);
  line-height: 1.7;
}

.audience-split__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.audience {
  display: flex;
  flex-direction: column;
  padding: 28px;
  border: 1px solid var(--zhin-line);
  border-radius: 14px;
  background: var(--vp-c-bg);
}

.audience__eyebrow {
  margin-bottom: 18px;
  color: var(--vp-c-brand);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.audience strong { color: var(--zhin-ink); font-size: 20px; }
.audience__who { margin-top: 6px; color: var(--zhin-ink-2); font-size: 13px; }
.audience p { margin: 12px 0 8px; color: var(--zhin-ink-2); font-size: 14px; line-height: 1.7; }
.audience ul { margin: 0 0 20px; padding-left: 18px; font-size: 14px; line-height: 1.9; }
.audience ul a { color: var(--vp-c-brand-dark); text-decoration: none; }
.audience ul a:hover { text-decoration: underline; }
.dark .audience ul a { color: var(--vp-c-brand-light); }
.audience__action { margin-top: auto; color: var(--vp-c-brand-dark); font-size: 14px; font-weight: 700; text-decoration: none; }
.dark .audience__action { color: var(--vp-c-brand-light); }

@media (max-width: 760px) {
  .audience-split__head { align-items: start; flex-direction: column; }
  .audience-split__grid { grid-template-columns: 1fr; }
}
</style>
