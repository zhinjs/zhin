<template>
  <div class="layout-container">
    <!-- PC端固定左侧菜单 -->
    <div v-if="!isMobile" class="layout-sidebar-fixed">
      <div class="layout-sidebar-header">
        <div class="layout-brand">
          <i class="pi pi-bolt text-primary text-2xl mr-2"></i>
          <span class="layout-brand-text">Zhin Bot</span>
        </div>
      </div>
      
      <div class="layout-sidebar-content">
        <PanelMenu 
          :model="processedMenus" 
          class="layout-menu"
          @item-click="onMenuClick"
        >
          <template #item="{ item }">
            <router-link 
              v-if="item.path && !item.items" 
              v-slot="{ href, navigate, isActive }" 
              :to="item.path" 
              custom
            >
              <a 
                v-ripple 
                :href="href" 
                :class="['layout-menu-item', { 'layout-menu-item-active': isActive }]"
                @click="navigate"
              >
                <i :class="item.icon || 'pi pi-circle'" class="layout-menu-icon"></i>
                <span class="layout-menu-label">{{ item.label }}</span>
                <Badge v-if="item.badge" :value="item.badge" class="ml-auto" />
              </a>
            </router-link>
            <span 
              v-else-if="item.items"
              :class="['layout-menu-category', { 'layout-menu-category-expanded': item.expanded }]"
            >
              <i :class="item.icon || 'pi pi-folder'" class="layout-menu-icon"></i>
              <span class="layout-menu-label">{{ item.label }}</span>
              <i class="pi pi-chevron-right layout-menu-arrow"></i>
            </span>
          </template>
        </PanelMenu>
        
        <!-- 菜单底部信息 -->
        <div class="layout-sidebar-footer">
          <div class="layout-system-info">
            <div class="text-sm text-color-secondary mb-2">系统信息</div>
            <div class="flex justify-content-between mb-1">
              <span class="text-xs">运行时间</span>
              <span class="text-xs">{{ uptime }}</span>
            </div>
            <div class="flex justify-content-between">
              <span class="text-xs">内存使用</span>
              <span class="text-xs">{{ memoryUsage }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 顶部导航栏 -->
    <header class="layout-topbar" :class="{ 'layout-topbar-with-sidebar': !isMobile }">
      <!-- 移动端左侧内容 -->
      <div v-if="isMobile" class="layout-topbar-start">
        <Button 
          icon="pi pi-bars" 
          class="layout-menu-toggle"
          text
          @click="toggleMobileSidebar"
          :aria-label="mobileSidebarVisible ? '收起菜单' : '展开菜单'"
        />
        <div class="layout-brand">
          <i class="pi pi-bolt text-primary text-2xl mr-2"></i>
          <span class="layout-brand-text">Zhin Bot</span>
        </div>
      </div>
      
      <!-- 右侧操作按钮 -->
      <div class="layout-topbar-actions">
        <!-- 全屏切换 -->
        <Button 
          :icon="isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
          text
          rounded
          @click="toggleFullscreen"
          v-tooltip="isFullscreen ? '退出全屏' : '全屏'"
        />
        
        <!-- 主题切换 -->
        <Button 
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          text
          rounded
          @click="toggleTheme"
          v-tooltip="isDark ? '浅色主题' : '深色主题'"
        />
        
        <!-- 用户菜单 -->
        <Button 
          icon="pi pi-user"
          text
          rounded
          @click="toggleUserMenu"
          aria-haspopup="true"
          aria-controls="user-menu"
          v-tooltip="'用户菜单'"
        />
        <OverlayPanel ref="userMenu" id="user-menu">
          <div class="user-menu">
            <div class="user-info mb-3">
              <i class="pi pi-user-circle text-4xl text-primary"></i>
              <div class="ml-3">
                <div class="font-medium">管理员</div>
                <div class="text-sm text-color-secondary">admin@zhin.bot</div>
              </div>
            </div>
            <Divider />
            <div class="flex flex-column gap-2">
              <Button icon="pi pi-cog" label="系统设置" text class="justify-content-start" />
              <Button icon="pi pi-question-circle" label="帮助文档" text class="justify-content-start" />
              <Button icon="pi pi-sign-out" label="退出登录" text class="justify-content-start" />
            </div>
          </div>
        </OverlayPanel>
      </div>
    </header>

    <!-- 移动端覆盖式侧边栏 -->
    <Sidebar 
      v-if="isMobile"
      v-model:visible="mobileSidebarVisible" 
      class="layout-mobile-sidebar"
      position="left"
    >
      <template #header>
        <div class="layout-brand mb-4">
          <i class="pi pi-bolt text-primary text-2xl mr-2"></i>
          <span class="layout-brand-text">Zhin Bot</span>
        </div>
      </template>
      
      <!-- 移动端菜单内容 -->
      <div class="layout-mobile-sidebar-content">
        <PanelMenu 
          :model="processedMenus" 
          class="layout-menu"
          @item-click="onMobileMenuClick"
        >
          <template #item="{ item }">
            <router-link 
              v-if="item.path && !item.items" 
              v-slot="{ href, navigate, isActive }" 
              :to="item.path" 
              custom
            >
              <a 
                v-ripple 
                :href="href" 
                :class="['layout-menu-item', { 'layout-menu-item-active': isActive }]"
                @click="navigate"
              >
                <i :class="item.icon || 'pi pi-circle'" class="layout-menu-icon"></i>
                <span class="layout-menu-label">{{ item.label }}</span>
                <Badge v-if="item.badge" :value="item.badge" class="ml-auto" />
              </a>
            </router-link>
            <span 
              v-else-if="item.items"
              :class="['layout-menu-category', { 'layout-menu-category-expanded': item.expanded }]"
            >
              <i :class="item.icon || 'pi pi-folder'" class="layout-menu-icon"></i>
              <span class="layout-menu-label">{{ item.label }}</span>
              <i class="pi pi-chevron-right layout-menu-arrow"></i>
            </span>
          </template>
        </PanelMenu>
      </div>
    </Sidebar>

    <!-- 主内容区域 -->
    <main class="layout-main" :class="{ 'layout-main-with-sidebar': !isMobile }">
      <div class="layout-content">
        <!-- 面包屑导航 -->
        <div class="layout-breadcrumb">
          <Breadcrumb :model="breadcrumbItems" />
        </div>
        
        <!-- 页面内容 -->
        <div class="layout-content-wrapper">
          <router-view v-slot="{ Component }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" />
            </Transition>
          </router-view>
        </div>
      </div>
    </main>

    <!-- 返回顶部按钮 -->
    <Transition name="fade">
      <Button 
        v-show="showBackToTop"
        icon="pi pi-chevron-up"
        class="layout-back-to-top"
        rounded
        @click="scrollToTop"
        v-tooltip="'返回顶部'"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useCommonStore } from '@zhin.js/client'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

// 组件引用
const userMenu = ref()

// 响应式状态
const isMobile = ref(false)
const mobileSidebarVisible = ref(false)
const isFullscreen = ref(false)
const isDark = ref(false)
const showBackToTop = ref(false)
const uptime = ref('0分钟')
const memoryUsage = ref('0MB')

// 路由相关
const router = useRouter()
const route = useRoute()

// 获取菜单数据
const menus = computed(() => {
  return (useCommonStore().store as any).menus || []
})

// 处理菜单数据，转换为PanelMenu格式
const processedMenus = computed(() => {
  return menus.value.map(menu => ({
    ...menu,
    label: menu.name,
    icon: menu.icon || 'pi pi-circle',
    items: menu.children?.map(child => ({
      ...child,
      label: child.name,
      path: child.path,
      icon: child.icon || 'pi pi-circle'
    }))
  }))
})

// 面包屑导航
const breadcrumbItems = computed(() => {
  const pathSegments = route.path.split('/').filter(Boolean)
  const items = [{ label: '首页', to: '/' }]
  
  let currentPath = ''
  pathSegments.forEach(segment => {
    currentPath += `/${segment}`
    const menu = findMenuByPath(currentPath)
    if (menu) {
      items.push({
        label: menu.name,
        to: currentPath
      })
    }
  })
  
  return items
})

// 查找菜单项
const findMenuByPath = (path: string) => {
  for (const menu of menus.value) {
    if (menu.path === path) return menu
    if (menu.children) {
      for (const child of menu.children) {
        if (child.path === path) return child
      }
    }
  }
  return null
}

// 响应式检测
const checkMobile = () => {
  const wasMobile = isMobile.value
  isMobile.value = window.innerWidth < 768
  
  // 当从移动端切换到桌面端时，关闭移动端侧边栏
  if (wasMobile && !isMobile.value && mobileSidebarVisible.value) {
    mobileSidebarVisible.value = false
  }
}

// 滚动检测
const checkScroll = () => {
  showBackToTop.value = window.scrollY > 300
}

// 系统信息更新
const updateSystemInfo = () => {
  // 模拟系统信息更新
  const now = Date.now()
  const startTime = now - Math.random() * 3600000 // 模拟运行时间
  uptime.value = `${Math.floor((now - startTime) / 60000)}分钟`
  memoryUsage.value = `${(Math.random() * 100 + 50).toFixed(1)}MB`
}

// 事件处理
const toggleMobileSidebar = () => {
  mobileSidebarVisible.value = !mobileSidebarVisible.value
}

const toggleUserMenu = (event: Event) => {
  userMenu.value?.toggle(event)
}

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
    isFullscreen.value = true
  } else {
    document.exitFullscreen()
    isFullscreen.value = false
  }
}

const toggleTheme = () => {
  isDark.value = !isDark.value
  // 这里可以实现主题切换逻辑
  const element = document.documentElement
  if (isDark.value) {
    element.classList.add('dark-theme')
  } else {
    element.classList.remove('dark-theme')
  }
}

const onMenuClick = (event: any) => {
  // PC端菜单点击不需要处理，保持菜单显示
}

const onMobileMenuClick = (event: any) => {
  // 移动端菜单点击后关闭侧边栏
  mobileSidebarVisible.value = false
}

const scrollToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}

// 生命周期
onMounted(() => {
  checkMobile()
  updateSystemInfo()
  
  window.addEventListener('resize', checkMobile)
  window.addEventListener('scroll', checkScroll)
  
  // 定期更新系统信息
  const timer = setInterval(updateSystemInfo, 30000)
  
  onUnmounted(() => {
    window.removeEventListener('resize', checkMobile)
    window.removeEventListener('scroll', checkScroll)
    clearInterval(timer)
  })
})
</script>

<style scoped>
/* ============================================================================ */
/* 布局容器 */
/* ============================================================================ */
.layout-container {
  display: flex;
  min-height: 100vh;
  background: var(--surface-ground);
}

/* ============================================================================ */
/* PC端固定侧边栏 */
/* ============================================================================ */
.layout-sidebar-fixed {
  position: fixed;
  top: 0;
  left: 0;
  width: 280px;
  height: 100vh;
  background: var(--surface-card);
  border-right: 1px solid var(--surface-border);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.layout-sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-50);
}

.layout-sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ============================================================================ */
/* 顶部导航栏 */
/* ============================================================================ */
.layout-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
  height: 60px;
  padding: 0 1rem;
  backdrop-filter: blur(10px);
  background: rgba(var(--surface-0-rgb), 0.9);
  border-bottom: 1px solid var(--surface-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.layout-topbar-with-sidebar {
  left: 280px;
}

.layout-topbar-start {
  display: flex;
  align-items: center;
}

.layout-menu-toggle {
  margin-right: 1rem;
}

.layout-brand {
  display: flex;
  align-items: center;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--primary-color);
}

.layout-brand-text {
  background: linear-gradient(135deg, var(--primary-color), var(--primary-color-text));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.layout-topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* 用户菜单样式 */
.user-menu {
  width: 250px;
  padding: 1rem;
}

.user-info {
  display: flex;
  align-items: center;
}

/* ============================================================================ */
/* 移动端侧边栏 */
/* ============================================================================ */
.layout-mobile-sidebar {
  width: 280px !important;
}

.layout-mobile-sidebar-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}



/* 菜单样式 */
.layout-menu {
  flex: 1;
  border: none;
  border-radius: 0;
  overflow-y: auto;
}

.layout-menu :deep(.p-panelmenu-panel) {
  border: none;
  border-radius: 0;
}

.layout-menu :deep(.p-panelmenu-header) {
  border: none;
  border-radius: 0;
  background: transparent;
}

.layout-menu :deep(.p-panelmenu-content) {
  border: none;
  background: transparent;
  padding: 0;
}

/* 菜单项样式 */
.layout-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.75rem 1.5rem;
  color: var(--text-color);
  text-decoration: none;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.layout-menu-item:hover {
  background: var(--surface-hover);
  color: var(--primary-color);
  border-left-color: var(--primary-color);
}

.layout-menu-item-active {
  background: var(--primary-50);
  color: var(--primary-color);
  border-left-color: var(--primary-color);
  font-weight: 600;
}

.layout-menu-icon {
  width: 1.5rem;
  margin-right: 0.75rem;
  font-size: 1rem;
}

.layout-menu-label {
  flex: 1;
  font-size: 0.875rem;
}

/* 菜单分类样式 */
.layout-menu-category {
  display: flex;
  align-items: center;
  padding: 0.5rem 1.5rem;
  color: var(--text-color-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 1rem;
}

.layout-menu-arrow {
  margin-left: auto;
  font-size: 0.75rem;
  transition: transform 0.2s ease;
}

.layout-menu-category-expanded .layout-menu-arrow {
  transform: rotate(90deg);
}

/* 侧边栏底部 */
.layout-sidebar-footer {
  margin-top: auto;
  padding: 1rem;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-50);
}

.layout-system-info {
  padding: 0.75rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

/* ============================================================================ */
/* 主内容区域 */
/* ============================================================================ */
.layout-main {
  flex: 1;
  margin-top: 60px;
  min-height: calc(100vh - 60px);
  background: var(--surface-ground);
  transition: all 0.3s ease;
}

.layout-main-with-sidebar {
  margin-left: 280px;
}

.layout-content {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

/* 面包屑导航 */
.layout-breadcrumb {
  margin-bottom: 2rem;
  padding: 1rem;
  background: var(--surface-card);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

/* 内容包装器 */
.layout-content-wrapper {
  background: var(--surface-card);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  min-height: 400px;
}

/* 返回顶部按钮 */
.layout-back-to-top {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 1000;
  width: 48px;
  height: 48px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

/* ============================================================================ */
/* 响应式设计 */
/* ============================================================================ */

/* 平板设备 */
@media (max-width: 1024px) {
  .layout-content {
    padding: 1.5rem;
  }
  
  .layout-sidebar-fixed {
    width: 260px;
  }
  
  .layout-topbar-with-sidebar {
    left: 260px;
  }
  
  .layout-main-with-sidebar {
    margin-left: 260px;
  }
}

/* 移动设备 */
@media (max-width: 768px) {
  .layout-container {
    flex-direction: column;
  }
  
  .layout-topbar {
    left: 0;
    padding: 0 0.75rem;
  }
  
  .layout-brand-text {
    display: none;
  }
  
  .layout-main {
    margin-left: 0;
  }
  
  .layout-main-with-sidebar {
    margin-left: 0;
  }
  
  .layout-content {
    padding: 1rem;
  }
  
  .layout-breadcrumb {
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .layout-back-to-top {
    bottom: 1rem;
    right: 1rem;
    width: 40px;
    height: 40px;
  }
  
  .layout-topbar-actions {
    gap: 0.25rem;
  }
  
  /* 移动端用户菜单 */
  .user-menu {
    width: 220px;
    padding: 0.75rem;
  }
}

/* 小屏手机 */
@media (max-width: 480px) {
  .layout-content {
    padding: 0.75rem;
  }
  
  .layout-breadcrumb {
    padding: 0.5rem;
  }
  
  .layout-topbar {
    padding: 0 0.5rem;
  }
  
  .user-menu {
    width: 200px;
  }
}

/* ============================================================================ */
/* 动画效果 */
/* ============================================================================ */

/* 页面切换动画 */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: all 0.3s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* 按钮悬停效果 */
.layout-topbar :deep(.p-button) {
  transition: all 0.2s ease;
}

.layout-topbar :deep(.p-button:hover) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 侧边栏滚动条样式 */
.layout-menu::-webkit-scrollbar {
  width: 4px;
}

.layout-menu::-webkit-scrollbar-track {
  background: transparent;
}

.layout-menu::-webkit-scrollbar-thumb {
  background: var(--surface-300);
  border-radius: 2px;
}

.layout-menu::-webkit-scrollbar-thumb:hover {
  background: var(--surface-400);
}

/* ============================================================================ */
/* 深色主题支持 */
/* ============================================================================ */
:root.dark-theme {
  --surface-ground: #0f172a;
  --surface-card: #1e293b;
  --surface-hover: #334155;
  --surface-border: #475569;
  --surface-50: #1a202c;
  --text-color: #e2e8f0;
  --text-color-secondary: #94a3b8;
  --primary-50: rgba(59, 130, 246, 0.1);
}

.dark-theme .layout-topbar {
  background: rgba(15, 23, 42, 0.8);
}

.dark-theme .layout-sidebar {
  background: #1e293b;
}

.dark-theme .layout-content-wrapper {
  background: #1e293b;
}

/* ============================================================================ */
/* 加载状态和空状态样式 */
/* ============================================================================ */
.layout-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-color-secondary);
}

.layout-empty {
  text-align: center;
  padding: 3rem;
  color: var(--text-color-secondary);
}

/* ============================================================================ */
/* 高级视觉效果 */
/* ============================================================================ */

/* 毛玻璃效果 */
.layout-topbar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: inherit;
  backdrop-filter: blur(10px);
  z-index: -1;
}

/* 阴影层次 */
.layout-content-wrapper {
  box-shadow: 
    0 1px 3px rgba(0, 0, 0, 0.05),
    0 4px 16px rgba(0, 0, 0, 0.03),
    0 8px 32px rgba(0, 0, 0, 0.02);
}

/* 聚焦状态 */
.layout-menu-item:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
  border-radius: 4px;
}

/* 高对比度支持 */
@media (prefers-contrast: high) {
  .layout-sidebar {
    border-right: 2px solid var(--surface-border);
  }
  
  .layout-menu-item {
    border-left-width: 4px;
  }
}

/* 减少动画支持 */
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
