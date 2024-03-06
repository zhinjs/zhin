<template>
  <router-view />
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { router, useCommonStore } from '@zhinjs/client';
export default defineComponent({
  name: 'App',
});
router.addRoute({
  path: '/',
  name: 'Admin',
  component: () => import('./pages/$.vue'),
  children: [
    {
      path: '',
      name: 'Dashboard',
      component: () => import('./pages/dashboard.vue'),
    },
  ],
});
</script>

<style scoped></style>
