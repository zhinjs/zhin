<script setup lang="ts">
withDefaults(defineProps<{ heading?: string }>(), { heading: '' })
</script>

<template>
  <section class="zhin-duo-section">
    <h2 v-if="heading" class="zhin-duo-section__title">{{ heading }}</h2>
    <div class="zhin-duo">
      <div class="zhin-duo__col"><slot name="left" /></div>
      <div class="zhin-duo__col"><slot name="right" /></div>
    </div>
    <p v-if="$slots.default" class="zhin-duo-section__more"><slot /></p>
  </section>
</template>

<style scoped>
.zhin-duo-section {
  max-width: 1080px;
  margin: 0 auto;
  padding: 72px 24px 0;
}

.zhin-duo-section__title {
  margin: 0 0 32px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--zhin-ink, #1d2b24);
  border: none;
}

.dark .zhin-duo-section__title {
  color: var(--zhin-ink, #e6ede8);
}

.zhin-duo-section__title::after {
  content: "";
  display: block;
  width: 42px;
  height: 3px;
  margin-top: 10px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--vp-c-brand), var(--vp-c-brand-lighter));
}

.zhin-duo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 768px) { .zhin-duo { grid-template-columns: 1fr; } }

.zhin-duo__col {
  min-width: 0;
}

.zhin-duo__col :deep(p:first-child) {
  margin-top: 0;
  font-size: 14px;
  color: var(--zhin-ink-2, #4a5b51);
}

.zhin-duo__col :deep([class*='language-']) {
  margin-top: 12px;
}

.zhin-duo-section__more {
  margin-top: 20px;
  font-size: 14px;
  color: var(--zhin-ink-2, #4a5b51);
}

.zhin-duo-section__more :deep(a) {
  color: var(--vp-c-brand-dark);
  font-weight: 500;
}

.dark .zhin-duo-section__more :deep(a) {
  color: var(--vp-c-brand-light);
}
</style>
