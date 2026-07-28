<script setup lang="ts">
interface FeatureItem {
  title: string
  desc: string
}

withDefaults(defineProps<{
  heading?: string
  features?: FeatureItem[]
}>(), {
  heading: '为什么是 Zhin.js',
  features: () => [
    { title: '插件化内核', desc: '一个 <code>package.json#zhin</code> 清单加一个 <code>plugin.ts</code> 就是一个插件。命令、组件、适配器按约定目录发现，改完文件即热重载。' },
    { title: '多平台，一套消息流', desc: 'QQ、OneBot、Discord、Telegram、Slack、KOOK、钉钉、飞书、企微、LINE…… 二十个适配器按需挂载，收发走同一条链路。' },
    { title: 'Console 免部署', desc: 'Host 只暴露 API。打开浏览器就能管插件、看实例、翻日志、改配置——前端不必跟着 Bot 跑。' },
    { title: 'AI 按需加装', desc: '默认只有 IM 核心。要 AI 时再装 <code>@zhin.js/agent</code>——providers、MCP、子代理、调度任务，逐层解锁。' },
    { title: '插件即应用', desc: '插件目录里放一个 <code>zhin.config.yml</code>，<code>zhin runtime start</code> 直接启动。不需要先写一个宿主工程。' },
    { title: '单向分层', desc: 'basic → kernel → ai → core → agent → zhin，依赖只往下走。每层都能单独拿来用——kernel 是纯插件引擎，ai 是纯 LLM 引擎。' },
  ],
})
</script>

<template>
  <section class="zhin-section">
    <h2 v-if="heading" class="zhin-section__title">{{ heading }}</h2>
    <div class="zhin-grid">
      <div v-for="(feature, index) in features" :key="feature.title" class="zhin-card">
        <span class="zhin-card__no">{{ String(index + 1).padStart(2, '0') }}</span>
        <h3>{{ feature.title }}</h3>
        <p v-html="feature.desc"></p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.zhin-section {
  max-width: 1080px;
  margin: 0 auto;
  padding: 72px 24px 0;
}

.zhin-section__title {
  margin: 0 0 32px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--zhin-ink, #1d2b24);
  border: none;
}

.dark .zhin-section__title {
  color: var(--zhin-ink, #e6ede8);
}

.zhin-section__title::after {
  content: "";
  display: block;
  width: 42px;
  height: 3px;
  margin-top: 10px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--vp-c-brand), var(--vp-c-brand-lighter));
}

.zhin-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) { .zhin-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .zhin-grid { grid-template-columns: 1fr; } }

.zhin-card {
  position: relative;
  padding: 22px 22px 20px;
  border: 1px solid var(--zhin-line, #e2e9e4);
  border-radius: 12px;
  background: var(--vp-c-bg);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.dark .zhin-card {
  border-color: var(--zhin-line, #2a352f);
}

.zhin-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-lighter);
  box-shadow: 0 14px 32px rgba(31, 96, 66, 0.10);
}

.zhin-card__no {
  display: inline-block;
  margin-bottom: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--vp-c-brand);
}

.zhin-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--zhin-ink, #1d2b24);
  border: none;
}

.dark .zhin-card h3 {
  color: var(--zhin-ink, #e6ede8);
}

.zhin-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--zhin-ink-2, #4a5b51);
}

.zhin-card p :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.86em;
  color: var(--vp-c-brand-darker);
  background: rgba(47, 158, 110, 0.10);
}

.dark .zhin-card p :deep(code) {
  color: var(--vp-c-brand-lighter);
  background: rgba(76, 195, 138, 0.12);
}
</style>
