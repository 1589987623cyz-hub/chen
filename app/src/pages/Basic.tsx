import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { createConfig, parseConfig } from '@/domain/params'
import { configJson } from '@/export/bundles'
import { useTheme, type Theme } from '@/features/Layout'
import { PageTitle, SelectField, SwitchField, TextField } from '@/features/shared'
import { useI18n, type Lang } from '@/i18n'
import { downloadBlob } from '@/lib/utils'
import {
  acceptInvite,
  cloudEnabled,
  deleteAllData,
  deleteConfig,
  exportAllData,
  getSession,
  listConfigs,
  saveConfig,
  supabase,
  type ConfigSummary,
} from '@/services/repo'

export function Home() {
  const { t } = useI18n()
  return (
    <div className="max-w-3xl">
      <PageTitle>{t('home.title')}</PageTitle>
      <p className="mt-3 text-lg">{t('home.lead')}</p>
      <Button asChild className="mt-5"><Link to="/dashboard">{t('home.start')}</Link></Button>

      <h2 className="mt-10 font-serif text-2xl font-semibold">{t('home.howTitle')}</h2>
      <ol className="mt-2 list-decimal ps-6">
        {[1, 2, 3, 4].map((n) => <li key={n}>{t(`home.how${n}`)}</li>)}
      </ol>

      <h2 className="mt-8 font-serif text-2xl font-semibold">{t('home.limitsTitle')}</h2>
      <ul className="mt-2 list-disc ps-6">
        {[1, 2, 3].map((n) => <li key={n}>{t(`home.limit${n}`)}</li>)}
      </ul>
    </div>
  )
}

export function Auth() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (kind: 'signIn' | 'signUp' | 'reset', event?: FormEvent) => {
    event?.preventDefault()
    if (!supabase) return
    const result =
      kind === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : kind === 'signUp'
          ? await supabase.auth.signUp({ email, password })
          : await supabase.auth.resetPasswordForEmail(email)
    if (result.error) setMessage(t('auth.failed', { message: result.error.message }))
    else if (kind === 'signIn') navigate(new URLSearchParams(location.search).get('next') ?? '/dashboard')
    else setMessage(t('auth.checkEmail'))
  }

  return (
    <div className="max-w-md">
      <PageTitle>{t('auth.title')}</PageTitle>
      {!cloudEnabled ? (
        <p className="mt-4 rounded-md border border-line bg-soft p-3">{t('auth.unconfigured')}</p>
      ) : (
        <form className="mt-4 grid gap-4" onSubmit={(e) => submit('signIn', e)}>
          <TextField label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label={t('auth.password')} hint={t('auth.passwordHint')} type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{t('auth.signIn')}</Button>
            <Button variant="outline" onClick={() => submit('signUp')}>{t('auth.signUp')}</Button>
            <Button variant="ghost" onClick={() => submit('reset')}>{t('auth.reset')}</Button>
          </div>
          <p role="status" className="min-h-6">{message}</p>
        </form>
      )}
    </div>
  )
}

export function Dashboard() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [items, setItems] = useState<ConfigSummary[] | null>(null)
  const [message, setMessage] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    if (cloudEnabled && !(await getSession())) {
      navigate('/auth?next=/dashboard')
      return
    }
    setItems(await listConfigs())
  }, [navigate])

  useEffect(() => {
    refresh().catch(() => setItems([]))
  }, [refresh])

  const create = async () => {
    const config = await saveConfig(createConfig(t('dash.defaultName')))
    navigate(`/configure/${config.id}`)
  }

  const importFile = async (selected?: File) => {
    if (!selected) return
    try {
      const config = parseConfig(await selected.text())
      const saved = await saveConfig({ ...config, id: crypto.randomUUID() })
      navigate(`/configure/${saved.id}`)
    } catch {
      setMessage(t('dash.importFailed'))
    }
  }

  return (
    <div className="max-w-3xl">
      <PageTitle>{t('dash.title')}</PageTitle>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={create}>{t('dash.new')}</Button>
        <Button variant="outline" onClick={() => file.current?.click()}>{t('dash.import')}</Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => importFile(e.target.files?.[0])}
        />
      </div>
      <p role="alert" className="mt-2 min-h-6 font-medium text-danger">{message}</p>

      {items === null && <p role="status">{t('common.loading')}</p>}
      {items?.length === 0 && <p className="mt-4">{t('dash.empty')}</p>}
      <ul className="mt-2 grid gap-3">
        {items?.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4">
            <div>
              <Link to={`/configure/${item.id}`} aria-label={t('dash.open', { name: item.name })} className="font-semibold underline">
                {item.name}
              </Link>
              {item.role === 'helper' && <span className="ms-2 text-sm">{t('dash.shared')}</span>}
              <p className="text-sm text-muted">
                {t('dash.updated', { date: new Date(item.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en') })}
              </p>
            </div>
            {item.role === 'owner' && (
              <Button
                variant="danger"
                aria-label={t('dash.deleteOne', { name: item.name })}
                onClick={async () => {
                  if (confirm(t('dash.confirmDelete', { name: item.name }))) {
                    await deleteConfig(item.id)
                    await refresh()
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Invite() {
  const { t } = useI18n()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    getSession().then((s) => setSignedIn(!!s))
  }, [])

  return (
    <div className="max-w-md">
      <PageTitle>{t('invite.title')}</PageTitle>
      <div className="mt-4">
        {!cloudEnabled && <p>{t('collab.needCloud')}</p>}
        {cloudEnabled && signedIn === false && (
          <>
            <p>{t('invite.signIn')}</p>
            <Button asChild className="mt-3">
              <Link to={`/auth?next=${encodeURIComponent(`/invite/${token}`)}`}>{t('nav.signIn')}</Link>
            </Button>
          </>
        )}
        {cloudEnabled && signedIn && (
          <Button
            onClick={async () => {
              try {
                navigate(`/configure/${await acceptInvite(token)}`)
              } catch {
                setMessage(t('invite.failed'))
              }
            }}
          >
            {t('invite.accept')}
          </Button>
        )}
        <p role="alert" className="mt-2 min-h-6 font-medium text-danger">{message}</p>
      </div>
    </div>
  )
}

export function Settings() {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, large, setLarge } = useTheme()
  const [message, setMessage] = useState('')
  return (
    <div className="grid max-w-xl gap-4">
      <PageTitle>{t('settings.title')}</PageTitle>
      <SelectField label={t('settings.language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </SelectField>
      <SelectField label={t('settings.theme')} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="default">{t('settings.themeDefault')}</option>
        <option value="contrast">{t('settings.themeContrast')}</option>
        <option value="dark">{t('settings.themeDark')}</option>
      </SelectField>
      <SwitchField label={t('settings.large')} checked={large} onCheckedChange={setLarge} />

      <h2 className="mt-4 font-serif text-2xl font-semibold">{t('settings.data')}</h2>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={async () => {
            downloadBlob(configJson(await exportAllData()), 'ex-sense-data.json')
          }}
        >
          {t('settings.exportData')}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (confirm(t('settings.confirmDelete'))) {
              await deleteAllData()
              setMessage(t('settings.deleted'))
            }
          }}
        >
          {t('settings.deleteData')}
        </Button>
      </div>
      <p role="status" className="min-h-6">{message}</p>
    </div>
  )
}

export function Accessibility() {
  const { t } = useI18n()
  return (
    <div className="max-w-3xl">
      <PageTitle>{t('a11y.title')}</PageTitle>
      <p className="mt-3">{t('a11y.goal')}</p>
      <p className="mt-3">{t('a11y.status')}</p>
      <p className="mt-3">{t('a11y.feedback')}</p>
    </div>
  )
}
