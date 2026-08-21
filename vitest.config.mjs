import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 主进程源码在浏览器 ESM 下没有 __dirname，electron-vite 构建时注入，
  // 测试时统一替换为 mock 目录，避免 ReferenceError
  define: {
    __dirname: '"/mock/__dirname"'
  },
  plugins: [
    {
      name: 'mock-asset-import',
      enforce: 'pre',
      resolveId(source) {
        if (source.includes('?asset')) return '\0mock-asset'
      },
      load(id) {
        if (id === '\0mock-asset') return 'export default "mock-icon.png"'
      }
    }
  ],
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.js']
  }
})
