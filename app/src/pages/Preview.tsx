import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { Config } from '@/domain/params'
import { MaskStage } from '@/features/MaskStage'
import { PageTitle, Section, SwitchField } from '@/features/shared'
import { INITIAL_SIMULATION, SimulationPanel } from '@/features/SimulationPanel'
import { useI18n } from '@/i18n'
import { resolveSimulation, type Simulation } from '@/scene/feedback'
import { cloudEnabled, getSharing, loadShared, setSharing, shareLink } from '@/services/repo'

export function ShareControl({ id }: { id: string }) {
  const { t } = useI18n()
  const [shared, setShared] = useState<boolean | null | 'loading'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    getSharing(id).then(setShared).catch(() => setShared(null))
  }, [id])

  if (!cloudEnabled) return <Section title={t('share.title')}><p className="text-sm text-muted">{t('share.needCloud')}</p></Section>
  if (shared === 'loading') return null
  if (shared === null) {
    return <Section title={t('share.title')}><p className="text-sm"><Link to="/auth" className="underline">{t('share.needSignIn')}</Link></p></Section>
  }
  return (
    <Section title={t('share.title')} hint={t('share.hint')}>
      <SwitchField
        label={t('share.switch')}
        checked={shared}
        onCheckedChange={async (next) => {
          try {
            await setSharing(id, next)
            setShared(next)
            setMessage('')
          } catch {
            setMessage(t('share.failed'))
          }
        }}
      />
      {shared && (
        <>
          <p className="break-all">{shareLink(id)}</p>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(shareLink(id))
              setMessage(t('share.copied'))
            }}
          >
            {t('collab.copy')}
          </Button>
        </>
      )}
      <p role="status" className="min-h-6">{message}</p>
    </Section>
  )
}

/** The read-only page behind a public link. Every load fetches the latest saved version. */
export function SharedPreview() {
  const { t, lang } = useI18n()
  const { id = '' } = useParams()
  const [config, setConfig] = useState<Config | null | 'loading'>('loading')
  const [sim, setSim] = useState<Simulation>(INITIAL_SIMULATION)
  const result = useMemo(() => (config && config !== 'loading' ? resolveSimulation(config, sim) : null), [config, sim])

  useEffect(() => {
    loadShared(id).then(setConfig).catch(() => setConfig(null))
  }, [id])

  if (config === 'loading') return <p role="status">{t('common.loading')}</p>
  if (!config || !result) return <p role="alert">{t('shared.missing')}</p>
  const date = new Date(config.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')
  return (
    <div>
      <PageTitle>{config.name}</PageTitle>
      <p className="mt-3 mb-5 text-muted">{t('shared.intro', { date })}</p>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(24rem,1fr)]">
        <div className="lg:sticky lg:top-4">
          <MaskStage config={config} state={result.state} stateName={t(`mode.${sim.kind}`)} pulseHz={result.pulseHz} />
        </div>
        <section aria-labelledby="sim-title" className="rounded-2xl border border-line bg-surface p-5">
          <h2 id="sim-title" className="gold-rule mb-4 font-serif text-2xl font-semibold">{t('sim.title')}</h2>
          <SimulationPanel config={config} sim={sim} result={result} onChange={setSim} />
        </section>
      </div>
    </div>
  )
}
