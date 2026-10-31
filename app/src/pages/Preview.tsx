import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SECTORS, ZONE_IDS, type Config, type Sector, type ZoneId } from '@/domain/params'
import { hasBlockingIssue } from '@/domain/validate'
import { useConfig } from '@/features/ConfigContext'
import { PageTitle, SelectField, SwitchField, TextField } from '@/features/shared'
import { contacts, maskParams, pins, sensors, tiles } from '@/geometry/mask'
import { useI18n, type Translate } from '@/i18n'
import { resolveSimulation, type Simulation, type SimulationKind, type SimulationResult } from '@/scene/feedback'
import { ViewerBoundary } from '@/scene/ViewerBoundary'
import { cloudEnabled, getSharing, loadShared, setSharing, shareLink } from '@/services/repo'

const MaskViewer = lazy(() => import('@/scene/MaskViewer'))

type ViewName = 'front' | 'side' | 'back' | 'top' | 'angle'

function describe(t: Translate, sim: Simulation, result: SimulationResult, cue: (cool: boolean) => string) {
  if (sim.kind === 'rest') return t('sim.rest')
  if (sim.kind === 'air') return result.state.kind === 'air' ? t('sim.airOn', { cue: cue(true) }) : t('sim.airOff')
  if (sim.kind === 'uv') return result.state.kind === 'uv' ? t('sim.uvOn', { cue: cue(false) }) : t('sim.uvOff')
  if (result.tier === 'none') return t('sim.none')
  if (!result.tileCount) return t('sim.blocked')
  const pattern =
    result.tier === 'hold' ? t('sim.hold') : t(result.tier === 'slow' ? 'sim.slow' : 'sim.fast', { hz: result.pulseHz })
  return t('sim.sector', {
    sector: t(`sector.${sim.sector}`),
    count: result.tileCount,
    mm: maskParams.tiles.travelIn,
    pattern,
  })
}

function ShareControl({ id }: { id: string }) {
  const { t } = useI18n()
  const [shared, setShared] = useState<boolean | null | 'loading'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    getSharing(id).then(setShared).catch(() => setShared(null))
  }, [id])

  if (!cloudEnabled) return <p className="text-sm text-muted">{t('share.needCloud')}</p>
  if (shared === 'loading') return null
  if (shared === null) {
    return <p className="text-sm"><Link to="/auth" className="underline">{t('share.needSignIn')}</Link></p>
  }
  return (
    <section aria-labelledby="share-title" className="grid gap-3 rounded-md border border-line p-3">
      <h2 id="share-title" className="font-semibold">{t('share.title')}</h2>
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
      <p className="text-sm text-muted">{t('share.hint')}</p>
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
    </section>
  )
}

export default function Preview() {
  const { t } = useI18n()
  const { config, issues, role } = useConfig()
  return (
    <PreviewView
      config={config}
      title={t('preview.title')}
      intro={<Link to=".." relative="path" className="underline">{t('common.back')}</Link>}
    >
      {role === 'owner' && <ShareControl id={config.id} />}
      {!hasBlockingIssue(issues) && (
        <Button asChild><Link to="../export" relative="path">{t('cfg.toExport')}</Link></Button>
      )}
    </PreviewView>
  )
}

/** The read-only page behind a public link. Every load fetches the latest saved version. */
export function SharedPreview() {
  const { t, lang } = useI18n()
  const { id = '' } = useParams()
  const [config, setConfig] = useState<Config | null | 'loading'>('loading')

  useEffect(() => {
    loadShared(id).then(setConfig).catch(() => setConfig(null))
  }, [id])

  if (config === 'loading') return <p role="status">{t('common.loading')}</p>
  if (!config) return <p role="alert">{t('shared.missing')}</p>
  const date = new Date(config.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')
  return <PreviewView config={config} title={config.name} intro={t('shared.intro', { date })} />
}

function PreviewView({ config, title, intro, children }: { config: Config; title: string; intro: ReactNode; children?: ReactNode }) {
  const { t } = useI18n()
  const [zone, setZone] = useState<ZoneId | ''>('')
  const [showOpen, setShowOpen] = useState(false)
  const [view, setView] = useState<ViewName>('front')
  const [explode, setExplode] = useState(false)
  const [sim, setSim] = useState<Simulation>({ kind: 'rest', sector: 'top', distance: 1.5, pm: 100, uv: 8 })
  const pro = config.mode === 'pro'

  const result = useMemo(() => resolveSimulation(config, sim), [config, sim])

  useEffect(() => {
    if (!pro) setExplode(false)
  }, [pro])

  const cue = (cool: boolean) => {
    const { thermal, tap } = config.cues
    if (thermal && tap) return t(cool ? 'sim.coolTap' : 'sim.warmTap')
    if (thermal) return t(cool ? 'sim.cool' : 'sim.warm')
    return t(cool ? 'sim.tap2' : 'sim.tap1')
  }
  const outcome = describe(t, sim, result, cue)
  const summary = t('desc.base', {
    tiles: tiles.length,
    pins: pins.length,
    sensors: sensors.length,
    contacts: contacts.length,
    state: t(`mode.${sim.kind}`),
  })

  return (
    <div>
      <PageTitle>{title}</PageTitle>
      <p className="mt-1 mb-4">{intro}</p>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="lg:sticky lg:top-4">
          <div className="h-96 lg:h-[36rem]">
            <ViewerBoundary fallback={<p role="alert">{t('preview.loadFailed')}</p>}>
              <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
                <MaskViewer
                  config={config}
                  state={result.state}
                  view={view}
                  showOpenZones={showOpen}
                  highlightZone={zone || null}
                  exploded={explode}
                  blinkHz={result.pulseHz}
                  label={summary}
                />
              </Suspense>
            </ViewerBoundary>
          </div>
          <p className="mt-2 text-sm text-muted">{t('preview.drag')}</p>
          <section className="mt-4 rounded-md border border-line p-3" aria-labelledby="desc-title">
            <h2 id="desc-title" className="font-semibold">{t('desc.title')}</h2>
            <p aria-live="polite">
              {summary} {t('desc.open')}
              {zone && ` ${t('desc.zone', { place: t(`place.${zone}`), count: tiles.filter((x) => x.zone === zone).length })}`}
            </p>
          </section>
        </div>

        <div className="grid gap-6">
          <section className="grid gap-4">
            <SelectField label={t('preview.view')} value={view} onChange={(e) => setView(e.target.value as ViewName)}>
              {(['front', 'side', 'back', 'top', 'angle'] as const).map((v) => <option key={v} value={v}>{t(`view.${v}`)}</option>)}
            </SelectField>
            <SelectField label={t('preview.zone')} value={zone} onChange={(e) => setZone(e.target.value as ZoneId | '')}>
              <option value="">{t('preview.zoneNone')}</option>
              {ZONE_IDS.map((z) => <option key={z} value={z}>{t(`place.${z}`)}</option>)}
            </SelectField>
            <SwitchField label={t('preview.showOpen')} checked={showOpen} onCheckedChange={setShowOpen} />
            {pro && <SwitchField label={t('preview.explode')} checked={explode} onCheckedChange={setExplode} />}
          </section>

          <section aria-labelledby="sim-title" className="grid gap-4">
            <h2 id="sim-title" className="font-serif text-2xl font-semibold">{t('sim.title')}</h2>
            <SelectField
              label={t('preview.state')}
              value={sim.kind}
              onChange={(e) => setSim({ ...sim, kind: e.target.value as SimulationKind })}
            >
              {(['rest', 'space', 'air', 'uv'] as const).map((m) => <option key={m} value={m}>{t(`mode.${m}`)}</option>)}
            </SelectField>
            {sim.kind === 'space' && (
              <>
                <SelectField
                  label={t('sim.direction')}
                  value={sim.sector}
                  onChange={(e) => setSim({ ...sim, sector: e.target.value as Sector })}
                >
                  {SECTORS.map((s) => <option key={s} value={s}>{t(`sector.${s}`)}</option>)}
                </SelectField>
                <TextField
                  label={t('sim.distance')}
                  type="number"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={sim.distance}
                  onChange={(e) => setSim({ ...sim, distance: Number(e.target.value) })}
                />
              </>
            )}
            {sim.kind === 'air' && (
              <TextField label={t('sim.pm')} type="number" min={0} max={500} value={sim.pm} onChange={(e) => setSim({ ...sim, pm: Number(e.target.value) })} />
            )}
            {sim.kind === 'uv' && (
              <TextField label={t('sim.uv')} type="number" min={0} max={15} value={sim.uv} onChange={(e) => setSim({ ...sim, uv: Number(e.target.value) })} />
            )}

            <div className="rounded-md border border-line bg-soft p-3">
              <h3 className="font-semibold">{t('sim.result')}</h3>
              <p aria-live="polite">{outcome}</p>
              <p className="mt-2 text-sm text-muted">{t('sim.priority')}</p>
            </div>
          </section>

          {children}
        </div>
      </div>
    </div>
  )
}
