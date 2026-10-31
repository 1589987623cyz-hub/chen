import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { Config, NumericKey } from '@/domain/params'
import { paramByKey } from '@/domain/params'
import { validate, type Issue } from '@/domain/validate'
import { useI18n } from '@/i18n'
import { loadConfig, saveConfig, type Role } from '@/services/repo'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

interface ConfigContextValue {
  config: Config
  role: Role
  issues: Issue[]
  saveState: SaveState
  update: (patch: Partial<Config>) => void
  setValue: (key: NumericKey, value: number) => void
  retrySave: () => void
}

const Context = createContext<ConfigContextValue | null>(null)

export function useConfig() {
  const value = useContext(Context)
  if (!value) throw new Error('useConfig needs ConfigRoute')
  return value
}

export function ConfigRoute() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<{ config: Config; role: Role } | null | 'loading'>('loading')

  useEffect(() => {
    let live = true
    setLoaded('loading')
    loadConfig(id)
      .then((result) => live && setLoaded(result))
      .catch(() => live && setLoaded(null))
    return () => {
      live = false
    }
  }, [id])

  if (loaded === 'loading') return <p role="status">{t('common.loading')}</p>
  if (!loaded) {
    return (
      <div className="max-w-xl">
        <p role="alert" className="font-medium">{t('common.notFound')}</p>
        <p className="mt-2 text-muted">{t('link.notYours')}</p>
        <Button asChild className="mt-4"><Link to="/start">{t('home.start')}</Link></Button>
      </div>
    )
  }
  return (
    <ConfigProvider key={id} initial={loaded.config} role={loaded.role}>
      <Outlet />
    </ConfigProvider>
  )
}

function ConfigProvider({ initial, role, children }: { initial: Config; role: Role; children: ReactNode }) {
  const { t } = useI18n()
  const [config, setConfig] = useState(initial)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saved = useRef(initial)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(config)
  latest.current = config

  const persist = useCallback(() => {
    setSaveState('saving')
    saveConfig(latest.current, role, saved.current)
      .then((next) => {
        saved.current = next
        setSaveState('saved')
      })
      .catch(() => setSaveState('failed'))
  }, [role])

  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(persist, 800)
  }, [persist])

  const update = useCallback(
    (patch: Partial<Config>) => {
      setConfig((c) => ({ ...c, ...patch }))
      schedule()
    },
    [schedule],
  )

  const setValue = useCallback(
    (key: NumericKey, value: number) => {
      setConfig((c) => {
        const next = { ...c, values: { ...c.values, [key]: value } }
        const param = paramByKey[key]
        if (param.group === 'measure') next.sizePreset = 'custom'
        if (param.group === 'feedback') next.feedbackConfirmed = false
        return next
      })
      schedule()
    },
    [schedule],
  )

  // A pending edit is written out when the page changes.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        persist()
      }
    },
    [persist],
  )

  const issues = useMemo(() => validate(config), [config])
  const value = useMemo(
    () => ({ config, role, issues, saveState, update, setValue, retrySave: persist }),
    [config, role, issues, saveState, update, setValue, persist],
  )

  return (
    <Context.Provider value={value}>
      <p role="status" aria-live="polite" className="mb-1 min-h-5 text-end text-sm text-muted">
        {saveState === 'saving' && t('common.saving')}
        {saveState === 'saved' && t('common.saved')}
      </p>
      {saveState === 'failed' && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 font-medium text-danger">
          {t('common.saveFailed')}
          <Button variant="outline" onClick={persist}>{t('common.retry')}</Button>
        </div>
      )}
      {children}
    </Context.Provider>
  )
}
