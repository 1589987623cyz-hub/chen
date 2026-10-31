import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { ConfigRoute } from '@/features/ConfigContext'
import { Layout, ThemeProvider } from '@/features/Layout'
import { I18nProvider } from '@/i18n'
import { Accessibility, Auth, Dashboard, Home, Invite, Settings } from '@/pages/Basic'
import Collaborators from '@/pages/Collaborators'
import Configure from '@/pages/Configure'
import Export from '@/pages/Export'
import Preview, { SharedPreview } from '@/pages/Preview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="auth" element={<Auth />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="configure/:id" element={<ConfigRoute />}>
                <Route index element={<Configure />} />
                <Route path="preview" element={<Preview />} />
                <Route path="export" element={<Export />} />
                <Route path="collaborators" element={<Collaborators />} />
              </Route>
              <Route path="view/:id" element={<SharedPreview />} />
              <Route path="invite/:token" element={<Invite />} />
              <Route path="settings" element={<Settings />} />
              <Route path="accessibility" element={<Accessibility />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
