<template>
  <div class="page-layout">
    <!-- 页面头部 -->
    <Card class="page-header-card">
      <template #content>
        <div class="flex-row justify-between">
          <div class="flex items-center space-x-4">
            <div class="bg-blue-500 hover:bg-blue-600 p-3 rounded-lg transition-colors">
              <i class="pi pi-desktop text-white text-xl"></i>
            </div>
            <div class="flex flex-col">
              <h1 class="text-2xl font-bold text-white">欢迎使用 Zhin Bot</h1>
              <p class="text-white/90">现代化的聊天机器人框架管理平台</p>
            </div>
          </div>
          <Button 
            icon="pi pi-refresh" 
            label="刷新数据" 
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
            <div class="icon-container icon-blue">
              <i class="pi pi-th-large"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ pluginsData?.length || 0 }}</div>
              <div class="stat-label">已安装插件</div>
              <div class="stat-sub">{{ activePluginsCount }} 个活跃</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-green">
              <i class="pi pi-sitemap"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ totalContexts }}</div>
              <div class="stat-label">上下文</div>
              <div class="stat-sub">{{ activeContexts }} 个活跃</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-purple">
              <i class="pi pi-code"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ totalCommands }}</div>
              <div class="stat-label">命令数量</div>
              <div class="stat-sub">来自所有插件</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-orange">
              <i class="pi pi-chart-bar"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ formatMemory(systemData?.memory.heapUsed) }}</div>
              <div class="stat-label">内存使用</div>
              <div class="stat-sub">{{ memoryUsagePercent }}% 已使用</div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- 主要内容区域 -->
    <div class="layout-container">
      <!-- 左侧：系统状态 + 插件概览 -->
      <div class="layout-main">
        <!-- 系统状态 -->
        <Card class="content-card">
          <template #title>
            <i class="pi pi-desktop"></i>
            <span>系统状态</span>
          </template>
          <template #content>
            <div class="detail-grid">
              <div class="detail-item">
                <div class="icon-container icon-small icon-blue">
                  <i class="pi pi-microchip"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">运行平台</div>
                  <div class="detail-value">{{ systemData?.platform }} {{ systemData?.nodeVersion }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-green">
                  <i class="pi pi-chart-line"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">内存使用情况</div>
                  <div class="detail-value">
                    {{ formatMemory(systemData?.memory.heapUsed) }} / {{ formatMemory(systemData?.memory.heapTotal) }}
                  </div>
                  <ProgressBar 
                    :value="memoryUsagePercent" 
                    :showValue="false"
                  />
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-purple">
                  <i class="pi pi-clock"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">进程信息</div>
                  <div class="detail-value">PID: {{ systemData?.pid }} · 运行时间: {{ formatUptime(systemData?.uptime) }}</div>
                </div>
              </div>
            </div>
          </template>
        </Card>

        <!-- 插件概览 -->
        <Card class="content-card">
          <template #title>
            <i class="pi pi-th-large"></i>
            <span>插件概览</span>
            <Button 
              label="查看全部" 
              text 
              size="small"
              @click="router.push('/plugins/installed')"
            />
          </template>
          <template #content>
            <div class="detail-grid">
              <div 
                v-for="plugin in pluginsData?.slice(0, 5)" 
                :key="plugin.name"
                class="detail-item"
              >
                <div class="icon-container icon-small icon-primary">
                  <i class="pi pi-puzzle-piece"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">{{ plugin.name }}</div>
                  <div class="detail-value flex-row">
                    <Tag 
                      :value="plugin.status" 
                      :severity="getStatusSeverity(plugin.status)"
                      size="small"
                    />
                    <span>{{ formatUptime(plugin.uptime) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <!-- 右侧：上下文状态 -->
      <div class="layout-sidebar">
        <Card class="content-card">
          <template #title>
            <i class="pi pi-sitemap"></i>
            <span>上下文状态</span>
            <Button 
              label="查看详情" 
              text 
              size="small"
              @click="router.push('/contexts/overview')"
            />
          </template>
          <template #content>
            <div class="grid-auto-fit">
              <div 
                v-for="adapter in adaptersData" 
                :key="adapter.name"
                class="context-item"
              >
                <div class="icon-container icon-small icon-primary">
                  <i :class="getPlatformIcon(adapter.platform)"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">{{ adapter.name }}</div>
                  <div class="detail-value">{{ adapter.status }}</div>
                </div>
                <Tag 
                  :value="adapter.status" 
                  :severity="getStatusSeverity(adapter.status)"
                  size="small"
                />
              </div>
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
import { useRouter } from 'vue-router'

const commonStore = useCommonStore()
const router = useRouter()
const refreshing = ref(false)
// 数据
const systemData = computed(() => (commonStore.store as any).system)
const pluginsData = computed(() => (commonStore.store as any).plugins || [])
const adaptersData = computed(() => (commonStore.store as any).adapters || [])

// 统计数据
const activePluginsCount = computed(() => {
  return pluginsData.value.length // 所有返回的插件都是活跃的
})

// 上下文统计（基于真实数据）
const totalContexts = computed(() => {
  // 核心上下文 + 服务上下文 + 从插件提供的上下文
  return pluginsData.value.reduce((total, plugin) => total + (plugin.context_count || 0), 0)
})

const activeContexts = computed(() => {
  // 所有上下文都是活跃的
  return totalContexts.value
})

const totalCommands = computed(() => {
  return pluginsData.value.reduce((total, plugin) => total + (plugin.command_count || 0), 0)
})

const memoryUsagePercent = computed(() => {
  if (!systemData.value?.memory) return 0
  const { heapUsed, heapTotal } = systemData.value.memory
  return Math.round((heapUsed / heapTotal) * 100)
})

// 格式化函数
const formatUptime = (seconds?: number) => {
  if (!seconds) return '0秒'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟`
  } else {
    return `${Math.floor(seconds)}秒`
  }
}

const formatMemory = (bytes?: number) => {
  if (!bytes) return '0B'
  
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

const getStatusSeverity = (status: string) => {
  switch (status) {
    case 'active': return 'success'
    case 'disposed':
    case 'inactive': return 'danger'
    default: return 'info'
  }
}

const getPlatformIcon = (platform: string) => {
  switch (platform) {
    case 'qq': return 'pi pi-comment'
    case 'kook': return 'pi pi-discord'
    case 'console': return 'pi pi-desktop'
    default: return 'pi pi-circle'
  }
}

const refreshData = async () => {
  refreshing.value = true
  try {
    // 使用全局API
    if (window.ZhinDataAPI?.updateAllData) {
      await window.ZhinDataAPI.updateAllData()
      // console.log 已替换为注释
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