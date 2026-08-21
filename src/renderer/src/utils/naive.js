import { createDiscreteApi } from 'naive-ui'

// 独立的 message / dialog 实例：无需 Provider 包裹，可在任意位置（含异步回调）直接使用
const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps: {
    // 与项目主色调保持一致
    themeOverrides: {
      common: {
        primaryColor: '#2563eb',
        primaryColorHover: '#1d4ed8',
        primaryColorPressed: '#1d4ed8'
      }
    }
  }
})

export { message, dialog }
