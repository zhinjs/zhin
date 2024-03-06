<script setup lang="ts">
import { useCommonStore } from '@zhinjs/client';
import { computed } from 'vue';
const commonStore = useCommonStore();
const menus = computed(() => {
  return commonStore.store['menus'] || [];
});
const activeMenu = computed(() => {
  return location.pathname;
});
</script>

<template>
  <el-container class="c-layout">
    <el-aside style="width: auto">
      <el-menu :default-active="activeMenu" router class="el-menu-demo">
        <h1>
          <el-link href="/"> Zhin </el-link>
        </h1>
        <template v-for="(parent, index) in menus" :key="index">
          <el-sub-menu v-if="parent.children?.length">
            <template #title>
              <el-icon v-if="parent.icon">
                <component :is="parent.icon"></component>
              </el-icon>
              {{ parent.name }}
            </template>
            <el-menu-item v-for="(child, idx) in parent.children" :key="`${index}:${idx}`" :index="child.path">
              <el-icon v-if="child.icon">
                <component :is="child.icon"></component>
              </el-icon>
              {{ child.name }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="parent.path">
            <el-icon v-if="parent.icon">
              <component :is="parent.icon"></component>
            </el-icon>
            {{ parent.name }}
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header> Zhin Web </el-header>
      <el-main>
        <router-view />
      </el-main>
      <el-footer>Zhin，license ICS，copyright @2022 - 2024</el-footer>
    </el-container>
  </el-container>
</template>

<style lang="less">
html,
body {
  padding-top: 0;
  margin: 0;
}
.c-layout {
  height: 100vh;
  .el-aside {
    display: flex;
    flex-direction: column;
    .el-menu {
      flex: auto;
      h1 {
        text-align: center;
        vertical-align: middle;
      }
    }
  }
  .el-header {
    border-bottom: 1px solid rgba(169, 169, 169, 0.53);
  }
  .el-header,
  .el-footer {
    display: flex;
    align-items: center;
  }
  .el-footer {
    justify-content: center;
  }
}
</style>
