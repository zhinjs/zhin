<template>
  <div class="page-layout">
    <!-- 页面头部 -->
    <Card class="page-header-card">
      <template #content>
        <div class="flex-row justify-between">
          <div class="flex-row">
            <div class="icon-container icon-primary">
              <i class="pi pi-info-circle"></i>
            </div>
            <div class="flex-column">
              <h1>系统状态</h1>
              <p>实时监控 Zhin Bot 框架运行状态</p>
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
            <div class="icon-container icon-uptime">
              <i class="pi pi-clock"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ formatUptime(systemData?.uptime) }}</div>
              <div class="stat-label">运行时间</div>
              <div class="stat-sub">系统持续运行</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-platform">
              <i class="pi pi-desktop"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ systemData?.platform }}</div>
              <div class="stat-label">运行平台</div>
              <div class="stat-sub">操作系统</div>
            </div>
          </div>
        </template>
      </Card>
      
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-nodejs">
              <i class="pi pi-code"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">{{ systemData?.nodeVersion }}</div>
              <div class="stat-label">Node.js</div>
              <div class="stat-sub">运行时版本</div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- 主要内容区域 -->
    <div class="layout-container">
      <!-- 左侧：系统信息 -->
      <div class="layout-main">
        <Card class="content-card">
          <template #title>
            <i class="pi pi-desktop"></i>
            <span>系统信息</span>
          </template>
          <template #content>
            <div class="detail-grid">
              <div class="detail-item">
                <div class="icon-container icon-small icon-blue">
                  <i class="pi pi-hashtag"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">进程 ID</div>
                  <div class="detail-value">{{ systemData?.pid }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-green">
                  <i class="pi pi-clock"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">运行时间</div>
                  <div class="detail-value">{{ formatUptime(systemData?.uptime) }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-purple">
                  <i class="pi pi-desktop"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">操作系统</div>
                  <div class="detail-value">{{ systemData?.platform }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-orange">
                  <i class="pi pi-code"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">Node.js 版本</div>
                  <div class="detail-value">{{ systemData?.nodeVersion }}</div>
                </div>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <!-- 右侧：内存使用 -->
      <div class="layout-sidebar">
        <Card class="content-card">
          <template #title>
            <i class="pi pi-chart-bar"></i>
            <span>内存使用</span>
          </template>
          <template #content>
            <div class="detail-grid">
              <div class="detail-item">
                <div class="icon-container icon-small icon-blue">
                  <i class="pi pi-chart-line"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">已用内存</div>
                  <div class="detail-value">{{ formatMemory(systemData?.memory.heapUsed) }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-green">
                  <i class="pi pi-chart-pie"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">总内存</div>
                  <div class="detail-value">{{ formatMemory(systemData?.memory.heapTotal) }}</div>
                </div>
              </div>
              
              <div class="detail-item">
                <div class="icon-container icon-small icon-purple">
                  <i class="pi pi-percentage"></i>
                </div>
                <div class="flex-column flex-1">
                  <div class="detail-label">使用率</div>
                  <div class="detail-value">{{ memoryUsagePercent }}%</div>
                  <ProgressBar 
                    :value="memoryUsagePercent" 
                    :showValue="false"
                  />
                </div>
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

const commonStore = useCommonStore()
const refreshing = ref(false)

// 系统数据
const systemData = computed(() => (commonStore.store as any).system)

// 内存使用百分比
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