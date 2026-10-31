import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { readStored, useI18n, writeStored } from '@/i18n'
import { cloudEnabled, supabase } from '@/services/repo'

export type Theme = 'default' | 'contrast' | 'dark'

interface ThemeValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  large: boolean
  setLarge: (large: boolean) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme needs ThemeProvider')
  return value
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (readStored('exsense.theme') as Theme) ?? 'default')
  const [large, setLarge] = useState(() => readStored('exsense.large') === '1')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeStored('exsense.theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.text = large ? 'large' : 'normal'
    writeStored('exsense.large', large ? '1' : '0')
  }, [large])

  const value = useMemo(() => ({ theme, setTheme, large, setLarge }), [theme, large])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function Layout() {
  const { t, lang, setLang } = useI18n()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session))
    const { data } = supabase.auth.onAuthStateChange((_, session) => setSignedIn(!!session))
    return () => data.subscription.unsubscribe()
  }, [])

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded px-2 py-2 underline-offset-4 hover:underline ${isActive ? 'font-semibold underline' : ''}`

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
      >
        {t('app.skip')}
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-serif text-xl font-semibold tracking-wide">EX-SENSE</Link>
          <nav aria-label={t('nav.primary')} className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={link}>{t('nav.home')}</NavLink>
            <NavLink to="/dashboard" className={link}>{t('nav.dashboard')}</NavLink>
            <NavLink to="/settings" className={link}>{t('nav.settings')}</NavLink>
            {cloudEnabled && !signedIn && <NavLink to="/auth" className={link}>{t('nav.signIn')}</NavLink>}
            {signedIn && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await supabase?.auth.signOut()
                  navigate('/')
                }}
              >
                {t('nav.signOut')}
              </Button>
            )}
            <Button
              variant="outline"
              lang={lang === 'zh' ? 'en' : 'zh-CN'}
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            >
              {t('lang.switch')}
            </Button>
          </nav>
        </div>
      </header>
      {!signedIn && !pathname.startsWith('/view/') && (
        <p className="bg-soft px-4 py-2 text-center text-sm">{t('common.localMode')}</p>
      )}
      <main id="main" key={pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-4 text-center text-sm">
        <Link to="/accessibility" className="underline">{t('nav.a11y')}</Link>
      </footer>
    </div>
  )
}
