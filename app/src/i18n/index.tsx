import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, zh } from './messages'

export type Lang = 'zh' | 'en'
export type Translate = (key: string, args?: Record<string, string | number>) => string

const dictionaries = { zh, en }

export function translate(lang: Lang, key: string, args?: Record<string, string | number>) {
  const text = dictionaries[lang][key] ?? key
  return text.replace(/\{(\w+)\}/g, (_, name) => String(args?.[name] ?? `{${name}}`))
}

function readStored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preferences still work for this visit without storage.
  }
}

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = readStored('exsense.lang')
    return stored === 'zh' ? 'zh' : 'en'
  })

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = translate(lang, 'app.name')
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    writeStored('exsense.lang', next)
    setLangState(next)
  }, [])

  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, args) => translate(lang, key, args) }),
    [lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n needs I18nProvider')
  return value
}

export { readStored }
