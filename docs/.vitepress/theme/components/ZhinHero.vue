<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow?: string
  title?: string
  tagline?: string
  logo?: string
}>(), {
  eyebrow: 'TypeScript · ESM · Plugin Runtime',
  title: 'Zhin.js',
  tagline: '',
  logo: '/logo.svg',
})
</script>

<template>
  <div class="zhin-hero">
    <div class="zhin-hero__glow" aria-hidden="true"></div>
    <div class="zhin-hero__inner">
      <div class="zhin-hero__text">
        <p class="zhin-hero__eyebrow">{{ eyebrow }}</p>
        <h1 class="zhin-hero__title">{{ title }}</h1>
        <p class="zhin-hero__tagline"><slot>{{ tagline }}</slot></p>
        <div class="zhin-hero__actions">
          <a class="zhin-btn zhin-btn--brand" href="/getting-started/">快速开始</a>
          <a class="zhin-btn zhin-btn--ghost" href="/examples/">示例速览</a>
          <a class="zhin-btn zhin-btn--ghost" href="https://github.com/zhinjs/zhin" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <div class="zhin-hero__meta">
          <span>IM 核心 &lt;10MB</span><i></i><span>Node ≥20.19</span><i></i><span>MIT</span>
        </div>
      </div>
      <div class="zhin-hero__logo">
        <img :src="logo" :alt="title" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.zhin-hero {
  position: relative;
  overflow: hidden;
  margin: -24px -24px 0;
  padding: 88px 24px 72px;
  background:
    radial-gradient(60% 90% at 85% 10%, rgba(76, 195, 138, 0.18), transparent 60%),
    radial-gradient(50% 70% at 10% 90%, rgba(47, 158, 110, 0.10), transparent 60%);
}

.dark .zhin-hero {
  background:
    radial-gradient(60% 90% at 85% 10%, rgba(76, 195, 138, 0.12), transparent 60%),
    radial-gradient(50% 70% at 10% 90%, rgba(47, 158, 110, 0.08), transparent 60%);
}

.zhin-hero__glow {
  position: absolute;
  inset: auto -10% -60% 40%;
  height: 480px;
  background: radial-gradient(closest-side, rgba(76, 195, 138, 0.22), transparent);
  filter: blur(60px);
  pointer-events: none;
}

.zhin-hero__inner {
  position: relative;
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 48px;
}

.zhin-hero__text {
  flex: 1 1 60%;
  min-width: 0;
}

.zhin-hero__eyebrow {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vp-c-brand-dark);
}

.dark .zhin-hero__eyebrow {
  color: var(--vp-c-brand-light);
}

.zhin-hero__title {
  margin: 0 0 18px;
  font-size: clamp(44px, 7vw, 68px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.02em;
  background: linear-gradient(120deg, var(--vp-c-brand-darker), var(--vp-c-brand) 55%, var(--vp-c-brand-lighter));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  border: none;
}

.dark .zhin-hero__title {
  background: linear-gradient(120deg, #d7f3e5, var(--vp-c-brand-light) 55%, var(--vp-c-brand));
  -webkit-background-clip: text;
  background-clip: text;
}

.zhin-hero__tagline {
  margin: 0 0 32px;
  font-size: clamp(16px, 2.2vw, 19px);
  line-height: 1.8;
  color: var(--zhin-ink-2, #4a5b51);
}

.zhin-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.zhin-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 22px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none !important;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.zhin-btn--brand {
  color: #fff !important;
  background: linear-gradient(135deg, var(--vp-c-brand), var(--vp-c-brand-dark));
  box-shadow: 0 6px 18px rgba(47, 158, 110, 0.35);
}

.zhin-btn--brand:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(47, 158, 110, 0.45);
}

.zhin-btn--ghost {
  color: var(--zhin-ink, #1d2b24) !important;
  border: 1px solid var(--zhin-line, #e2e9e4);
  background: transparent;
}

.dark .zhin-btn--ghost {
  color: var(--zhin-ink, #e6ede8) !important;
  border-color: var(--zhin-line, #2a352f);
}

.zhin-btn--ghost:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand-dark) !important;
}

.dark .zhin-btn--ghost:hover {
  color: var(--vp-c-brand-light) !important;
}

.zhin-hero__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 28px;
  font-size: 13px;
  color: var(--zhin-ink-2, #4a5b51);
}

.zhin-hero__meta i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--vp-c-brand);
}

.zhin-hero__logo {
  flex: 0 0 220px;
  display: flex;
  justify-content: center;
}

.zhin-hero__logo img {
  width: 200px;
  height: 200px;
  filter: drop-shadow(0 18px 40px rgba(47, 158, 110, 0.35));
}

@media (max-width: 768px) {
  .zhin-hero__inner {
    flex-direction: column-reverse;
    text-align: center;
    gap: 24px;
  }
  .zhin-hero__actions,
  .zhin-hero__meta {
    justify-content: center;
  }
  .zhin-hero__logo img {
    width: 140px;
    height: 140px;
  }
}
</style>
