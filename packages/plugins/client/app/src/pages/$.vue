<script setup lang="ts">
import { useCommonStore } from '@/store';
import { computed } from 'vue';
const commonStore = useCommonStore();
const menus = computed(() => {
  return commonStore.menus;
});
</script>

<template>
  <el-container style="height: 100vh">
    <el-header>
      <el-menu router class="el-menu-demo">
        <el-menu-item v-for="(item, index) in menus" :key="index" :index="item.path">
          {{ item.name }}
        </el-menu-item>
      </el-menu>
    </el-header>
    <el-container>
      <el-aside width="200px">Aside</el-aside>
      <el-container>
        <el-main><router-view></router-view></el-main>
        <el-footer>Footer</el-footer>
      </el-container>
    </el-container>
  </el-container>
</template>

<style scoped lang="less"></style>
