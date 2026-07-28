<script setup lang="ts">
withDefaults(defineProps<{ title?: string }>(), { title: 'zsh' })
</script>

<template>
  <div class="zhin-terminal">
    <div class="zhin-terminal__bar">
      <span class="r"></span><span class="y"></span><span class="g"></span>
      <em>{{ title }}</em>
    </div>
    <pre><code><slot /></code></pre>
  </div>
</template>

<style scoped>
.zhin-terminal {
  max-width: 760px;
  margin: 48px auto 0;
  border: 1px solid var(--zhin-line, #e2e9e4);
  border-radius: 12px;
  overflow: hidden;
  background: #0f1a14;
  box-shadow: 0 20px 48px rgba(15, 26, 20, 0.25);
}

.zhin-terminal__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #16241c;
}

.zhin-terminal__bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.zhin-terminal__bar .r { background: #e0655e; }
.zhin-terminal__bar .y { background: #e0b45e; }
.zhin-terminal__bar .g { background: #63c47e; }

.zhin-terminal__bar em {
  margin-left: auto;
  font-size: 12px;
  font-style: normal;
  color: #5f7a6a;
}

.zhin-terminal pre {
  margin: 0;
  padding: 18px 20px 20px;
  font-size: 14px;
  line-height: 1.9;
  overflow-x: auto;
}

.zhin-terminal code {
  font-family: var(--vp-font-family-mono);
  color: #d7efe2;
  background: transparent;
}

.zhin-terminal code :deep(b) {
  color: var(--vp-c-brand-light);
  font-weight: 600;
}

.zhin-terminal code :deep(span) {
  color: #6f9a83;
}

/* 行尾光标闪烁（最后一行末尾） */
.zhin-terminal code::after {
  content: "▌";
  margin-left: 2px;
  color: var(--vp-c-brand-light);
  animation: zhin-caret-blink 1.1s steps(1) infinite;
}

@keyframes zhin-caret-blink {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .zhin-terminal code::after {
    animation: none !important;
  }
}
</style>
