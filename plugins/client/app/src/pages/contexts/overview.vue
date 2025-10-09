<template>
  <div class="page-layout">
    <!-- 页面头部 -->
    <Card class="page-header-card">
      <template #content>
        <div class="flex-row justify-between">
          <div class="flex-row">
            <div class="icon-container icon-primary">
              <i class="pi pi-sitemap"></i>
            </div>
            <div class="flex-column">
              <h1>上下文管理</h1>
              <p>管理和监控框架中的所有上下文</p>
            </div>
          </div>
          <Button 
            icon="pi pi-refresh" 
            label="刷新" 
            @click="refreshData" 
            :loading="refreshing"
            severity="secondary"
            outlined
          />
        </div>
      </template>
    </Card>

    <!-- 统计卡片 -->
    <div class="stats-container">
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-total">
              <i class="pi pi-sitemap"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ totalContexts }}</div>
              <div class="stat-label">总上下文数</div>
              <div class="stat-sub">所有已注册上下文</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-active">
              <i class="pi pi-check-circle"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ activeContexts }}</div>
              <div class="stat-label">活跃上下文</div>
              <div class="stat-sub">正在运行中</div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- 主要内容区域 -->
    <div class="layout-container">
      <div class="layout-main">
        <Card class="content-card">
          <template #title>
            <i class="pi pi-list"></i>
            <span>所有上下文</span>
            <Button 
              icon="pi pi-refresh" 
              severity="secondary"
              text 
              rounded 
              size="small"
              :loading="refreshing"
              @click="refreshData"
              v-tooltip="'刷新数据'"
            />
          </template>
          <template #content>
            <div v-if="allContexts.length" class="grid-auto-fit">
              <div 
                v-for="context in allContexts" 
                :key="context.name"
                class="context-item"
              >
                <div class="icon-container icon-small icon-primary">
                  <i class="pi pi-circle-fill"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">{{ context.name }}</div>
                  <div class="detail-value">{{ context.description }}</div>
                </div>
                <div class="flex-none">
                  <Tag 
                    value="活跃" 
                    severity="success"
                    icon="pi pi-check"
                    size="small"
                  />
                </div>
              </div>
            </div>
            <div v-else class="empty-state">
              <div class="icon-container">
                <i class="pi pi-sitemap"></i>
              </div>
              <h3>暂无上下文</h3>
              <p>系统中还没有注册任何上下文</p>
            </div>
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommonStore } from '@zhin.js/client'

const commonStore = useCommonStore()
const refreshing = ref(false)

// 系统数据
const systemData = computed(() => (commonStore.store as any).system)
const pluginsData = computed(() => (commonStore.store as any).plugins || [])
const adaptersData = computed(() => (commonStore.store as any).adapters || [])

// 上下文数据（从多个来源聚合）
const allContexts = computed(() => {
  const contexts = []
  
  // 从系统数据中获取上下文（如果有的话）
  if (systemData.value?.contexts) {
    contexts.push(...systemData.value.contexts.map(ctx => ({
      name: ctx.name,
      description: ctx.description || `${ctx.name} 上下文`,
      status: 'active'
    })))
  }
  
  // 从适配器数据中添加上下文
  contexts.push(...adaptersData.value.map(adapter => ({
    name: adapter.name,
    description: adapter.description || `${adapter.platform} 平台适配器`,
    status: adapter.status || 'active'
  })))
  
  return contexts
})

// 统计数据
const totalContexts = computed(() => allContexts.value.length)
const activeContexts = computed(() => 
  allContexts.value.filter(ctx => ctx.status === 'active').length
)

// 刷新数据
const refreshData = async () => {
  refreshing.value = true
  try {
    if (window.ZhinDataAPI?.updateAllData) {
      await window.ZhinDataAPI.updateAllData()
    } else {
      throw new Error('全局API未就绪')
    }
  } catch (error) {
    // console.error 已替换为注释
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
/* 页面特定样式 - 所有样式已移至 common.css，使用PrimeVue组件类名控制 */
</style>