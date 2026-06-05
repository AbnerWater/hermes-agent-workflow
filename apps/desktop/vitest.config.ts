import { mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

export default mergeConfig(viteConfig, {
  test: {
    environment: 'jsdom',
    exclude: ['node_modules/**', 'dist/**', 'release/**', 'build/**', 'electron/**', 'scripts/**'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts']
  }
})
