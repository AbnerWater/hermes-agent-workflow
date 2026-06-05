import './styles.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import App from './app'
import { ErrorBoundary } from './components/error-boundary'
import { HapticsProvider } from './components/haptics-provider'
import { useAppLanguage } from './i18n'
import { installClipboardShim } from './lib/clipboard'
import { queryClient } from './lib/query-client'
import { ThemeProvider } from './themes/context'

installClipboardShim()

// Dev-only: install __PERF_DRIVE__ + __PERF_PROBE__ on window so the
// scripts/ harnesses can drive a synthetic stream + record render cost.
// Tree-shaken out of production builds. (Uses MODE rather than DEV because
// our Vite setup currently bundles with PROD=true even in `vite dev`; see
// scripts/dev-no-hmr.mjs for the surrounding workarounds.)
if (import.meta.env.MODE !== 'production') {
  import('./app/chat/perf-probe')
}

function AppLanguageEffect() {
  const language = useAppLanguage()

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="root">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <HapticsProvider>
            <AppLanguageEffect />
            <HashRouter>
              <App />
            </HashRouter>
          </HapticsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
