import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { hasBlockingIssue } from '@/domain/validate'
import { configJson, printPackage, rhinoFile, specHtml } from '@/export/bundles'
import { useConfig } from '@/features/ConfigContext'
import { PageTitle } from '@/features/shared'
import { useI18n } from '@/i18n'
import { downloadBlob } from '@/lib/utils'

interface ExportItem {
  id: string
  title: string
  hint: string
  filename: string
  needsValid: boolean
  build: () => Blob | Promise<Blob>
}

export default function Export() {
  const { t, lang } = useI18n()
  const { config, issues } = useConfig()
  const [working, setWorking] = useState('')
  const [message, setMessage] = useState('')
  const errors = issues.filter((i) => i.severity === 'error')
  const blocked = hasBlockingIssue(issues)
  const slug = config.name.replace(/[\\/:*?"<>|\s]+/g, '-') || 'ex-sense'

  const items: ExportItem[] = [
    { id: 'package', title: t('export.package'), hint: t('export.packageHint'), filename: `${slug}-models.zip`, needsValid: true, build: () => printPackage(config) },
    { id: 'config', title: t('export.config'), hint: t('export.configHint'), filename: `${slug}.json`, needsValid: false, build: () => configJson(config) },
    { id: 'spec', title: t('export.spec'), hint: t('export.specHint'), filename: `${slug}-spec.html`, needsValid: true, build: () => new Blob([specHtml(config, lang)], { type: 'text/html' }) },
    ...(config.mode === 'pro'
      ? [{ id: 'rhino', title: t('export.rhino'), hint: t('export.rhinoHint'), filename: `${slug}.3dm`, needsValid: true, build: () => rhinoFile(config) }]
      : []),
  ]

  const run = async (item: ExportItem) => {
    setWorking(item.id)
    setMessage(t('export.working'))
    // Yield once so the status is announced before the heavier work starts.
    await new Promise((resolve) => setTimeout(resolve, 30))
    try {
      downloadBlob(await item.build(), item.filename)
      setMessage(t('export.done', { name: item.filename }))
    } catch {
      setMessage(t('export.failed'))
    } finally {
      setWorking('')
    }
  }

  return (
    <div className="max-w-3xl">
      <PageTitle>{t('export.title')}</PageTitle>
      <p className="mt-1 mb-4">
        <Link to=".." relative="path" className="underline">{t('common.back')}</Link>
      </p>
      <p className="mb-4 text-muted">{t('export.concept')}</p>

      {blocked && (
        <p role="alert" className="mb-4 rounded-md border border-danger p-3 font-medium text-danger">
          {t('export.blocked', { n: errors.length })}{' '}
          <Link to=".." relative="path" className="underline">{t('export.review')}</Link>
        </p>
      )}
      {!config.feedbackConfirmed && <p className="mb-4 rounded-md border border-line bg-soft p-3">{t('export.unconfirmed')}</p>}

      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4">
            <div className="min-w-0 flex-1 basis-64">
              <h2 className="font-semibold">{item.title}</h2>
              <p className="text-sm text-muted">{item.hint}</p>
            </div>
            <Button
              disabled={!!working || (item.needsValid && blocked)}
              aria-label={`${t('export.download')} ${item.title}`}
              onClick={() => run(item)}
            >
              {working === item.id ? t('export.working') : t('export.download')}
            </Button>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="mt-4 min-h-6 font-medium">{message}</p>
    </div>
  )
}
