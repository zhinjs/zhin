<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { lang } = useData()
const isEn = computed(() => lang.value === 'en-US')

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
          <a class="zhin-btn zhin-btn--brand" :href="isEn ? '/en/getting-started/' : '/getting-started/'">{{ isEn ? 'Quick Start' : '快速开始' }}</a>
          <a class="zhin-btn zhin-btn--ghost" :href="isEn ? '/en/examples/' : '/examples/'">{{ isEn ? 'Examples' : '示例速览' }}</a>
          <a class="zhin-btn zhin-btn--ghost" href="https://github.com/zhinjs/zhin" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <div class="zhin-hero__meta">
          <span>{{ isEn ? 'IM core <10MB' : 'IM 核心 <10MB' }}</span><i></i><span>Node ≥20.19</span><i></i><span>MIT</span>
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
  margin: 0 -24px;
  padding: 96px 24px 80px;
  background:
    radial-gradient(55% 80% at 88% 8%, var(--zhin-c2-bg, rgba(79, 143, 247, 0.10)), transparent 62%),
    radial-gradient(45% 65% at 70% 95%, var(--zhin-c3-bg, rgba(139, 92, 246, 0.10)), transparent 60%),
    radial-gradient(50% 75% at 8% 85%, var(--zhin-c1-bg, rgba(47, 158, 110, 0.10)), transparent 62%),
    radial-gradient(40% 55% at 20% 5%, var(--zhin-c6-bg, rgba(20, 184, 196, 0.10)), transparent 60%);
}

.dark .zhin-hero {
  background:
    radial-gradient(55% 80% at 88% 8%, var(--zhin-c2-bg, rgba(111, 165, 248, 0.14)), transparent 62%),
    radial-gradient(45% 65% at 70% 95%, var(--zhin-c3-bg, rgba(166, 132, 250, 0.14)), transparent 60%),
    radial-gradient(50% 75% at 8% 85%, var(--zhin-c1-bg, rgba(76, 195, 138, 0.14)), transparent 62%),
    radial-gradient(40% 55% at 20% 5%, var(--zhin-c6-bg, rgba(58, 200, 212, 0.14)), transparent 60%);
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
  background: linear-gradient(115deg,
    var(--zhin-c1, #2f9e6e), var(--zhin-c6, #14b8c4),
    var(--zhin-c2, #4f8ff7), var(--zhin-c3, #8b5cf6),
    var(--zhin-c5, #ec5f8f), var(--zhin-c1, #2f9e6e));
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  border: none;
  animation: zhin-gradient-shift 12s ease-in-out infinite;
}

.dark .zhin-hero__title {
  background: linear-gradient(115deg,
    #d7f3e5, var(--zhin-c6, #3ac8d4),
    var(--zhin-c2, #6fa5f8), var(--zhin-c3, #a684fa),
    var(--zhin-c5, #f27daa), #d7f3e5);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: zhin-gradient-shift 12s ease-in-out infinite;
}

@keyframes zhin-gradient-shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
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
  position: relative;
  overflow: hidden;
  color: #fff !important;
  background: linear-gradient(135deg, var(--zhin-c1, #2f9e6e), var(--zhin-c6, #14b8c4));
  box-shadow: 0 6px 18px rgba(47, 158, 110, 0.35);
}

.zhin-btn--brand::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
  transform: translateX(-110%);
  transition: transform 0.55s ease;
}

.zhin-btn--brand:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(47, 158, 110, 0.45);
}

.zhin-btn--brand:hover::after {
  transform: translateX(110%);
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
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--vp-c-brand);
}

.zhin-hero__meta span:nth-of-type(2) + i { background: var(--zhin-c6, #14b8c4); }
.zhin-hero__meta span:nth-of-type(3) + i { background: var(--zhin-c3, #8b5cf6); }

.zhin-hero__logo {
  flex: 0 0 220px;
  display: flex;
  justify-content: center;
  position: relative;
}

.zhin-hero__logo::before {
  content: "";
  position: absolute;
  inset: 12% 8%;
  border-radius: 50%;
  background: radial-gradient(closest-side,
    var(--zhin-c2-bg, rgba(79, 143, 247, 0.10)),
    var(--zhin-c1-bg, rgba(47, 158, 110, 0.10)), transparent 75%);
  animation: zhin-glow-pulse 5s ease-in-out infinite;
}

@keyframes zhin-glow-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.95); }
  50% { opacity: 1; transform: scale(1.05); }
}

.zhin-hero__logo img {
  position: relative;
  width: 200px;
  height: 200px;
  filter: drop-shadow(0 18px 40px rgba(47, 158, 110, 0.35));
  animation: zhin-float 5.5s ease-in-out infinite;
}

@keyframes zhin-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@media (prefers-reduced-motion: reduce) {
  .zhin-hero__title,
  .zhin-hero__logo img,
  .zhin-hero__logo::before {
    animation: none !important;
  }
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
