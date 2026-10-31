import { lazy, Suspense, useState } from 'react'
import type { Config, ZoneId } from '@/domain/params'
import { contacts, pins, sensors, tiles } from '@/geometry/mask'
import { useI18n } from '@/i18n'
import { REST, type MaskState } from '@/scene/feedback'
import { ViewerBoundary } from '@/scene/ViewerBoundary'
import { Segmented, SwitchField } from './shared'

const MaskViewer = lazy(() => import('@/scene/MaskViewer'))

const VIEWS = ['front', 'angle', 'side', 'top', 'back'] as const

interface MaskStageProps {
  config: Config
  state?: MaskState
  stateName?: string
  pulseHz?: number
  highlightZone?: ZoneId | null
  selected?: string | null
  pressed?: string[]
  onSelect?: (id: string | null) => void
}

/** The model and its view controls, the same on every page that shows it. */
export function MaskStage({ config, state = REST, stateName, pulseHz, highlightZone, selected, pressed, onSelect }: MaskStageProps) {
  const { t } = useI18n()
  const [view, setView] = useState<(typeof VIEWS)[number]>('front')
  const [showOpen, setShowOpen] = useState(false)
  const [exploded, setExploded] = useState(false)
  const summary = t('desc.base', {
    tiles: tiles.length,
    pins: pins.length,
    sensors: sensors.length,
    contacts: contacts.length,
    state: stateName ?? t('mode.rest'),
  })

  return (
    <div className="grid gap-3">
      <div className="h-[26rem] overflow-hidden rounded-2xl border border-line lg:h-[calc(100vh-15rem)] lg:min-h-[30rem]">
        <ViewerBoundary fallback={<p role="alert" className="p-4">{t('preview.loadFailed')}</p>}>
          <Suspense fallback={<p role="status" className="p-4">{t('common.loading')}</p>}>
            <MaskViewer
              config={config}
              state={state}
              view={view}
              showOpenZones={showOpen}
              highlightZone={highlightZone}
              exploded={exploded}
              blinkHz={pulseHz}
              selected={selected}
              pressed={pressed}
              onSelect={onSelect}
              label={summary}
            />
          </Suspense>
        </ViewerBoundary>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Segmented
          label={t('preview.view')}
          value={view}
          onChange={setView}
          options={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`) }))}
        />
        <div className="flex flex-wrap gap-x-6">
          <SwitchField label={t('preview.showOpen')} checked={showOpen} onCheckedChange={setShowOpen} />
          {config.mode === 'pro' && <SwitchField label={t('preview.explode')} checked={exploded} onCheckedChange={setExploded} />}
        </div>
      </div>
      <p className="text-sm text-muted">{onSelect ? t('preview.dragPick') : t('preview.drag')}</p>
      <p aria-live="polite" className="sr-only">{summary} {t('desc.open')}</p>
    </div>
  )
}
