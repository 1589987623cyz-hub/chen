import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ZONE_IDS, type Direction, type Height, type Region, type ZoneId } from '@/domain/params'
import { hasBlockingIssue } from '@/domain/validate'
import { useConfig } from '@/features/ConfigContext'
import { PageTitle, SelectField, SwitchField, TextField } from '@/features/shared'
import { zoneDeploy, type WearState } from '@/geometry/mask'
import { useI18n, type Translate } from '@/i18n'
import { simulateObstacle, type Obstacle, type SpaceResult } from '@/scene/feedback'
import { useDeploy } from '@/scene/useDeploy'
import { ViewerBoundary } from '@/scene/ViewerBoundary'

const MaskViewer = lazy(() => import('@/scene/MaskViewer'))

type ViewName = 'front' | 'side' | 'top' | 'angle'

function describeSpace(t: Translate, result: SpaceResult) {
  if (result.tier === 'none') return t('sim.none')
  const pattern =
    result.tier === 'hold' ? t('sim.hold') : t(result.tier === 'slow' ? 'sim.slow' : 'sim.fast', { hz: result.pulseHz })
  if (result.earOnly) return t('sim.ear', { pattern })
  if (result.blockedByState || !result.zones.length) return t('sim.blocked')
  const zones = [...new Set(result.zones.map((z) => z.zone))].join(t('common.list'))
  const sides = new Set(result.zones.map((z) => z.side))
  const side = sides.size > 1 ? t('sim.both') : `${t(sides.has(1) ? 'sim.left' : 'sim.right')}: `
  return t('sim.zones', { sides: side, zones, pattern })
}

export default function Preview() {
  const { t } = useI18n()
  const { config, issues } = useConfig()
  const [state, setState] = useState<WearState>('full')
  const [region, setRegion] = useState<Region>('upper')
  const [zone, setZone] = useState<ZoneId | ''>('')
  const [showOpen, setShowOpen] = useState(false)
  const [view, setView] = useState<ViewName>('front')
  const [fit, setFit] = useState(false)
  const [explode, setExplode] = useState(false)
  const [obstacle, setObstacle] = useState<Obstacle>({ direction: 'front', height: 'head', side: 'left', distance: 3 })
  const [pm, setPm] = useState(40)
  const [uv, setUv] = useState(3)
  const pro = config.mode === 'pro'

  const target = useMemo(() => zoneDeploy(config, state, region), [config, state, region])
  const deploy = useDeploy(target)
  const space = useMemo(() => simulateObstacle(config, obstacle, state, target), [config, obstacle, state, target])

  useEffect(() => {
    if (!pro) {
      setFit(false)
      setExplode(false)
    }
  }, [pro])

  const open = ZONE_IDS.filter((z) => target[z] > 0)
  const closed = ZONE_IDS.filter((z) => target[z] === 0)
  const listSep = t('common.list')
  const intrusion = issues.some((i) => i.code === 'openZone')
  const zoneMap = zone ? config.zoneMap[zone] : null
  const meaning = zoneMap
    ? t('common.pair', {
        a: t(`dir.${zoneMap.direction}`),
        b: zoneMap.heights.map((h) => t(`height.${h}`)).join(' / '),
      })
    : t('desc.noMap')

  const cue = (cool: boolean) => {
    const { thermal, tap } = config.cues
    if (thermal && tap) return t(cool ? 'sim.coolTap' : 'sim.warmTap')
    if (thermal) return t(cool ? 'sim.cool' : 'sim.warm')
    return t(cool ? 'sim.tap2' : 'sim.tap1')
  }
  const airActive = config.cues.air && pm >= config.values.pmThreshold
  const uvActive = config.cues.uv && uv >= config.values.uvThreshold

  return (
    <div>
      <PageTitle>{t('preview.title')}</PageTitle>
      <p className="mt-1 mb-4">
        <Link to=".." relative="path" className="underline">{t('common.back')}</Link>
      </p>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="lg:sticky lg:top-4">
          <div className="h-96 lg:h-[36rem]">
            <ViewerBoundary fallback={<p role="alert">{t('preview.loadFailed')}</p>}>
              <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
                <MaskViewer
                  config={config}
                  deploy={deploy}
                  view={view}
                  showOpenZones={showOpen}
                  highlightZone={zone || null}
                  exploded={explode}
                  fitMode={fit}
                  active={space.zones}
                  blinkHz={space.pulseHz}
                  label={t('desc.base', {
                    state: t(`state.${state}`),
                    open: open.join(listSep) || t('desc.none'),
                    closed: closed.join(listSep) || t('desc.none'),
                  })}
                />
              </Suspense>
            </ViewerBoundary>
          </div>
          <p className="mt-2 text-sm text-muted">{t('preview.drag')}</p>
          <section className="mt-4 rounded-md border border-line p-3" aria-labelledby="desc-title">
            <h2 id="desc-title" className="font-semibold">{t('desc.title')}</h2>
            <p aria-live="polite">
              {t('desc.base', {
                state: t(`state.${state}`),
                open: open.join(listSep) || t('desc.none'),
                closed: closed.join(listSep) || t('desc.none'),
              })}{' '}
              {t(intrusion ? 'desc.intrusion' : 'desc.open')}
              {zone && ` ${t('desc.zone', { zone, place: t(`place.${zone}`), meaning })}`}
            </p>
          </section>
        </div>

        <div className="grid gap-6">
          <section className="grid gap-4">
            <SelectField label={t('preview.view')} value={view} onChange={(e) => setView(e.target.value as ViewName)}>
              {(['front', 'side', 'top', 'angle'] as const).map((v) => <option key={v} value={v}>{t(`view.${v}`)}</option>)}
            </SelectField>
            <SelectField label={t('preview.state')} value={state} onChange={(e) => setState(e.target.value as WearState)}>
              {(['standby', 'adaptive', 'full'] as const).map((s) => <option key={s} value={s}>{t(`state.${s}`)}</option>)}
            </SelectField>
            {state === 'adaptive' && (
              <SelectField label={t('preview.region')} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
                {(['upper', 'middle', 'lower'] as const).map((r) => <option key={r} value={r}>{t(`region.${r}`)}</option>)}
              </SelectField>
            )}
            <SelectField label={t('preview.zone')} value={zone} onChange={(e) => setZone(e.target.value as ZoneId | '')}>
              <option value="">{t('preview.zoneNone')}</option>
              {ZONE_IDS.map((z) => <option key={z} value={z}>{`${z} ${t(`place.${z}`)}`}</option>)}
            </SelectField>
            <SwitchField label={t('preview.showOpen')} checked={showOpen} onCheckedChange={setShowOpen} />
            {pro && (
              <>
                <SwitchField label={t('preview.fit')} checked={fit} onCheckedChange={setFit} />
                <SwitchField label={t('preview.explode')} checked={explode} onCheckedChange={setExplode} />
              </>
            )}
          </section>

          <section aria-labelledby="sim-title" className="grid gap-4">
            <h2 id="sim-title" className="font-serif text-2xl font-semibold">{t('sim.title')}</h2>
            <h3 className="font-semibold">{t('sim.obstacle')}</h3>
            <SelectField
              label={t('sim.direction')}
              value={obstacle.direction}
              onChange={(e) => setObstacle({ ...obstacle, direction: e.target.value as Direction })}
            >
              {(['front', 'diagonal', 'side'] as const).map((d) => <option key={d} value={d}>{t(`dir.${d}`)}</option>)}
            </SelectField>
            <SelectField
              label={t('sim.height')}
              value={obstacle.height}
              onChange={(e) => setObstacle({ ...obstacle, height: e.target.value as Height })}
            >
              {(['head', 'chest', 'waist'] as const).map((h) => <option key={h} value={h}>{t(`height.${h}`)}</option>)}
            </SelectField>
            {obstacle.direction !== 'front' && (
              <SelectField
                label={t('sim.side')}
                value={obstacle.side}
                onChange={(e) => setObstacle({ ...obstacle, side: e.target.value as Obstacle['side'] })}
              >
                <option value="left">{t('sim.left')}</option>
                <option value="right">{t('sim.right')}</option>
              </SelectField>
            )}
            <TextField
              label={t('sim.distance')}
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              value={obstacle.distance}
              onChange={(e) => setObstacle({ ...obstacle, distance: Number(e.target.value) })}
            />
            <h3 className="font-semibold">{t('sim.env')}</h3>
            <TextField label={t('sim.pm')} type="number" min={0} max={500} value={pm} onChange={(e) => setPm(Number(e.target.value))} />
            <TextField label={t('sim.uv')} type="number" min={0} max={15} value={uv} onChange={(e) => setUv(Number(e.target.value))} />

            <div className="rounded-md border border-line bg-soft p-3">
              <h3 className="font-semibold">{t('sim.result')}</h3>
              <ul aria-live="polite" className="list-disc ps-6">
                <li>{describeSpace(t, space)}</li>
                <li>{airActive ? t('sim.airOn', { cue: cue(true) }) : t('sim.airOff')}</li>
                <li>{uvActive ? t('sim.uvOn', { cue: cue(false) }) : t('sim.uvOff')}</li>
              </ul>
              <p className="mt-2 text-sm text-muted">{t('sim.priority')}</p>
            </div>
          </section>

          {!hasBlockingIssue(issues) && (
            <Button asChild><Link to="../export" relative="path">{t('cfg.toExport')}</Link></Button>
          )}
        </div>
      </div>
    </div>
  )
}
