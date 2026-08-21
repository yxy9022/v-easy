<script setup>
import { computed, ref } from 'vue'
import WatermarkPage from './pages/WatermarkPage.vue'
import CropPage from './pages/CropPage.vue'
import MergePage from './pages/MergePage.vue'
import SpeedPage from './pages/SpeedPage.vue'
import CompressPage from './pages/CompressPage.vue'
import ConvertPage from './pages/ConvertPage.vue'

// 全局 Naive UI 主题：统一主色为蓝色，避免组件（如 n-switch 激活态）默认绿色与页面风格不一致
const themeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
    primaryColorSuppl: '#3b82f6'
  }
}

// 视频功能菜单：新增功能时在这里加一项即可，component 为对应的处理组件
const menus = [
  {
    key: 'crop',
    label: '视频裁剪',
    icon: 'M7 1v12a4 4 0 0 0 4 4h12M1 7h12a4 4 0 0 1 4 4v12',
    component: CropPage
  },
  {
    key: 'watermark',
    label: '视频去水印',
    icon: 'M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z',
    component: WatermarkPage
  },
  {
    key: 'merge',
    label: '视频合并',
    icon: 'M9 3v18M3 12h12m0 0-4-4m4 4-4 4',
    component: MergePage
  },
  {
    key: 'speed',
    label: '视频加速',
    icon: 'M5 5l7 7-7 7M13 5l7 7-7 7',
    component: SpeedPage
  },
  {
    key: 'compress',
    label: '视频压缩',
    icon: 'M12 3v10m0 0 4-4m-4 4-4-4M3 21h18',
    component: CompressPage
  },
  {
    key: 'convert',
    label: '视频转码',
    icon: 'M4 9h13m0 0-4-4m4 4-4 4M20 15H7m0 0 4 4m-4-4 4-4',
    component: ConvertPage
  }
]

const activeKey = ref(menus[0].key)
const sidebarCollapsed = ref(false)

const activeMenu = computed(() => menus.find((m) => m.key === activeKey.value))

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" style="height: 100%">
    <div class="app">
      <!-- 左侧：logo + 菜单栏 -->
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="brand">
          <span class="brand-text">v-easy</span>
          <span class="brand-mini">V</span>
        </div>
        <nav class="menu">
          <div
            v-for="item in menus"
            :key="item.key"
            class="menu-item"
            :class="{ active: item.key === activeKey }"
            :data-tip="item.label"
            @click="activeKey = item.key"
          >
            <svg
              class="menu-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="item.icon" />
            </svg>
            <span class="menu-label">{{ item.label }}</span>
          </div>
        </nav>
      </aside>

      <!-- 右侧：顶栏 + 内容区 -->
      <div class="main">
        <header class="topbar">
          <button
            type="button"
            class="sidebar-toggle"
            :class="{ collapsed: sidebarCollapsed }"
            :aria-label="sidebarCollapsed ? '展开菜单' : '折叠菜单'"
            @click="toggleSidebar"
          >
            <!-- 展开状态：三条横线，点击折叠 -->
            <svg
              v-if="!sidebarCollapsed"
              class="toggle-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <!-- 折叠状态：面板 + 箭头，点击展开 -->
            <svg
              v-else
              class="toggle-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d="M13 9l3 3-3 3" />
            </svg>
          </button>
          <div class="topbar-title">{{ activeMenu.label }}</div>
        </header>
        <main class="content">
          <component :is="activeMenu.component" />
        </main>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}

/* ---------- 左侧：logo + 菜单栏 ---------- */
.sidebar {
  display: flex;
  flex-direction: column;
  width: 200px;
  flex-shrink: 0;
  background-color: #ffffff;
  border-right: 1px solid #e2e8f0;
  padding: 12px;
  /* 允许悬停 Tooltip 溢出侧边栏显示 */
  overflow: visible;
  transition: width 0.25s ease;
}

.sidebar.collapsed {
  width: 64px;
}

.brand {
  position: relative;
  padding: 8px 12px 20px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #2563eb;
  white-space: nowrap;
}

.brand-text,
.brand-mini {
  transition: opacity 0.2s ease;
}

.brand-mini {
  position: absolute;
  left: 12px;
  top: 8px;
  opacity: 0;
  pointer-events: none;
}

.sidebar.collapsed .brand-text {
  opacity: 0;
}

.sidebar.collapsed .brand-mini {
  opacity: 1;
}

.menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ---------- 右侧：顶栏 + 内容区 ---------- */
.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  flex-shrink: 0;
  padding: 0 20px;
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #ffffff;
  color: #475569;
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.sidebar-toggle:hover {
  background-color: #f1f5f9;
  border-color: #cbd5e1;
  color: #0f172a;
}

/* 折叠状态下按钮高亮，提示当前可点击展开 */
.sidebar-toggle.collapsed {
  background-color: #eff6ff;
  border-color: #93c5fd;
  color: #2563eb;
}

.sidebar-toggle.collapsed:hover {
  background-color: #dbeafe;
}

.toggle-icon {
  width: 18px;
  height: 18px;
}

.topbar-title {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.menu-item:hover {
  background-color: #f1f5f9;
  color: #0f172a;
}

.menu-item.active {
  background-color: #2563eb;
  color: #ffffff;
}

.menu-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.menu-label {
  transition: opacity 0.2s ease;
}

.sidebar.collapsed .menu-label {
  display: none;
}

/* 折叠后菜单显示居中的小图标 */
.sidebar.collapsed .menu-icon {
  width: 16px;
  height: 16px;
}

/* ---------- 折叠状态美化 ---------- */

/* 折叠时品牌缩写与菜单图标居中 */
.sidebar.collapsed .brand {
  padding-left: 0;
  padding-right: 0;
  text-align: center;
}

.sidebar.collapsed .brand-mini {
  left: 0;
  right: 0;
}

.sidebar.collapsed .menu-item {
  position: relative;
  justify-content: center;
  padding: 10px 0;
}

.sidebar.collapsed .menu-item:hover::after {
  content: attr(data-tip);
  position: absolute;
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
  padding: 5px 10px;
  border-radius: 6px;
  background-color: #0f172a;
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.sidebar.collapsed .menu-item:hover::after {
  opacity: 1;
}

/* 右侧内容区：禁止页面级滚动，页面内容全部自适应，内部区域自行滚动 */
.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 24px 28px;
}
</style>
