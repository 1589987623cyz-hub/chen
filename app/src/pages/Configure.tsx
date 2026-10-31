import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  NUMERIC_PARAMS,
  SIZE_PRESETS,
  ZONE_IDS,
  type NumericKey,
  type SizePreset,
  type ZoneId,
} from '@/domain/params'
import { estimateMass, hasBlockingIssue } from '@/domain/validate'
import { useConfig } from '@/features/ConfigContext'
import { issueText, NumberField, PageTitle, Section, SelectField, SwitchField, TextField } from '@/features/shared'
import { useI18n } from '@/i18n'
import { ViewerBoundary } from '@/scene/ViewerBoundary'

const MaskViewer = lazy(() => import('@/scene/MaskViewer'))

const keysOf = (group: string, mode?: 'simple' | 'pro') =>
  NUMERIC_PARAMS.filter((p) => p.group === group && (!mode || p.mode === mode)).map((p) => p.key as NumericKey)

function SizeStep() {
  const { t } = useI18n()
  const { config, update } = useConfig()
  return (
    <>
      <p className="mb-4 text-muted">{t('size.lead')}</p>
      <p className="mb-4 rounded-md border border-line bg-soft p-3">{t('size.fixedModel')}</p>
      <SelectField
        label={t('size.preset')}
        value={config.sizePreset}
        onChange={(e) => {
          const size = e.target.value as SizePreset | 'custom'
          if (size === 'custom') return
          update({ sizePreset: size, values: { ...config.values, ...SIZE_PRESETS[size] } })
        }}
      >
        <option value="S">S</option>
        <option value="M">M</option>
        <option value="L">L</option>
        <option value="custom" disabled={config.sizePreset !== 'custom'}>{t('size.custom')}</option>
      </SelectField>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {keysOf('measure').map((key) => <NumberField key={key} name={key} />)}
      </div>
    </>
  )
}

function ZonesStep() {
  const { t } = useI18n()
  const { config, update } = useConfig()
  const toggle = (zone: ZoneId, on: boolean) =>
    update({ enabledZones: on ? [...config.enabledZones, zone] : config.enabledZones.filter((z) => z !== zone) })
  return (
    <>
      <p className="mb-4 text-muted">{t('zones.lead')}</p>
      <div className="grid gap-1">
        {ZONE_IDS.map((zone) => (
          <SwitchField
            key={zone}
            label={t(`place.${zone}`)}
            checked={config.enabledZones.includes(zone)}
            onCheckedChange={(on) => toggle(zone, on)}
          />
        ))}
      </div>
    </>
  )
}

const FEEDBACK_PRESETS: Record<string, Partial<Record<NumericKey, number>>> = {
  gentle: { hapticLevel: 2, thermalLevel: 1, cueDuration: 1.5 },
  balanced: { hapticLevel: 3, thermalLevel: 2, cueDuration: 2 },
  strong: { hapticLevel: 5, thermalLevel: 3, cueDuration: 3 },
}

function FeedbackStep() {
  const { t } = useI18n()
  const { config, role, update } = useConfig()
  const locked = role === 'helper'
  const setCue = (key: keyof typeof config.cues, on: boolean) =>
    update({ cues: { ...config.cues, [key]: on }, feedbackConfirmed: false })
  return (
    <>
      <p className="mb-4 text-muted">{t('fb.lead')}</p>
      <Section title={t('fb.cues')}>
        {(['space', 'air', 'uv', 'thermal', 'tap'] as const).map((cue) => (
          <SwitchField
            key={cue}
            label={t(`cue.${cue}`)}
            checked={config.cues[cue]}
            disabled={locked}
            onCheckedChange={(on) => setCue(cue, on)}
          />
        ))}
      </Section>
      <Section title={t('fb.alerts')}>
        <SelectField
          label={t('fb.preset')}
          disabled={locked}
          defaultValue=""
          onChange={(e) => {
            const preset = FEEDBACK_PRESETS[e.target.value]
            if (preset) update({ values: { ...config.values, ...preset }, feedbackConfirmed: false })
          }}
        >
          <option value="" disabled>—</option>
          <option value="gentle">{t('fb.presetGentle')}</option>
          <option value="balanced">{t('fb.presetBalanced')}</option>
          <option value="strong">{t('fb.presetStrong')}</option>
        </SelectField>
        {keysOf('feedback', 'simple').map((key) => <NumberField key={key} name={key} disabled={locked} />)}
        {ZONE_IDS.filter((z) => config.enabledZones.includes(z)).map((zone) => (
          <SelectField
            key={zone}
            label={t('zones.haptic', { zone: t(`place.${zone}`) })}
            disabled={locked}
            value={config.hapticByZone[zone] ?? ''}
            onChange={(e) => {
              const next = { ...config.hapticByZone }
              if (e.target.value) next[zone] = Number(e.target.value)
              else delete next[zone]
              update({ hapticByZone: next, feedbackConfirmed: false })
            }}
          >
            <option value="">{t('zones.hapticDefault')}</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </SelectField>
        ))}
      </Section>
      {config.mode === 'pro' && (
        <Section title={t('fb.distance')}>
          {keysOf('feedback', 'pro').map((key) => <NumberField key={key} name={key} disabled={locked} />)}
        </Section>
      )}
      <div className="mt-6 rounded-md border border-line bg-soft p-3">
        <SwitchField
          label={t('fb.confirm')}
          hint={t('fb.confirmHint')}
          checked={config.feedbackConfirmed}
          disabled={locked}
          onCheckedChange={(feedbackConfirmed) => update({ feedbackConfirmed })}
        />
      </div>
    </>
  )
}

function StructureStep() {
  const { t } = useI18n()
  const { config, update } = useConfig()
  return (
    <>
      <p className="mb-4 text-muted">{t('struct.lead')}</p>
      <SelectField
        label={t('struct.printPreset')}
        value={config.printPreset}
        onChange={(e) => update({ printPreset: e.target.value as typeof config.printPreset })}
      >
        <option value="fdm">{t('struct.fdm')}</option>
        <option value="service">{t('struct.service')}</option>
      </SelectField>
    </>
  )
}

function ReviewStep({ onGo }: { onGo: (step: string) => void }) {
  const { t } = useI18n()
  const { issues } = useConfig()
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const stepForField = (issue: (typeof issues)[number]) => {
    if (!issue.field) return 'feedback'
    return NUMERIC_PARAMS.find((p) => p.key === issue.field)!.group === 'measure' ? 'size' : 'feedback'
  }
  return (
    <div className="grid gap-4">
      <p role="status" className={errors.length ? 'font-semibold text-danger' : 'font-semibold text-ok'}>
        {errors.length ? t('review.errors', { n: errors.length }) : t('review.ok')}
      </p>
      {errors.length > 0 && (
        <ul className="grid gap-2">
          {errors.map((issue, i) => {
            const step = stepForField(issue)
            return (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger p-3">
                <span>
                  {issue.field
                    ? t('review.fieldIssue', { field: t(`param.${issue.field}`), issue: issueText(t, issue) })
                    : issueText(t, issue)}
                </span>
                <Button variant="outline" onClick={() => onGo(step)}>
                  {t('review.goField', { step: t(`step.${step}`) })}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {warnings.length > 0 && (
        <div>
          <h3 className="font-semibold">{t('review.warnings')}</h3>
          <ul className="list-disc ps-6">
            {warnings.map((issue, i) => <li key={i} className="text-warn">{issueText(t, issue)}</li>)}
          </ul>
        </div>
      )}
      <p>{t('review.mass', { g: estimateMass().toFixed(0) })}</p>
    </div>
  )
}

export default function Configure() {
  const { t } = useI18n()
  const { config, role, issues, update } = useConfig()
  const steps = useMemo(
    () => ['size', 'zones', 'feedback', ...(config.mode === 'pro' ? ['structure'] : []), 'review'],
    [config.mode],
  )
  const [step, setStep] = useState('size')
  const current = steps.includes(step) ? step : 'size'
  const index = steps.indexOf(current)
  const heading = useRef<HTMLHeadingElement>(null)

  const go = (next: string) => {
    setStep(next)
    requestAnimationFrame(() => heading.current?.focus())
  }

  const blocked = hasBlockingIssue(issues)

  return (
    <div>
      <div className="mb-4">
        <PageTitle>{config.name}</PageTitle>
      </div>
      {role === 'helper' && <p className="mb-4 rounded-md border border-line bg-soft p-3">{t('cfg.helperNote')}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <TextField label={t('cfg.name')} value={config.name} onChange={(e) => update({ name: e.target.value })} />
        <SelectField
          label={t('cfg.modeLabel')}
          value={config.mode}
          onChange={(e) => update({ mode: e.target.value as typeof config.mode })}
        >
          <option value="simple">{t('cfg.modeSimple')}</option>
          <option value="pro">{t('cfg.modePro')}</option>
        </SelectField>
      </div>

      <nav aria-label={t('cfg.steps')} className="mb-6">
        <ol className="flex flex-wrap gap-2">
          {steps.map((s) => (
            <li key={s}>
              <Button
                variant={s === current ? 'default' : 'outline'}
                aria-current={s === current ? 'step' : undefined}
                onClick={() => go(s)}
              >
                {t(`step.${s}`)}
              </Button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="step-heading">
          <p className="text-sm text-muted">{t('cfg.stepOf', { n: index + 1, total: steps.length })}</p>
          <h2 id="step-heading" ref={heading} tabIndex={-1} className="mb-3 font-serif text-2xl font-semibold outline-none">
            {t(`${current === 'size' ? 'size' : current === 'zones' ? 'zones' : current === 'feedback' ? 'fb' : current === 'structure' ? 'struct' : 'review'}.title`)}
          </h2>
          {current === 'size' && <SizeStep />}
          {current === 'zones' && <ZonesStep />}
          {current === 'feedback' && <FeedbackStep />}
          {current === 'structure' && <StructureStep />}
          {current === 'review' && <ReviewStep onGo={go} />}

          <div className="mt-6 flex flex-wrap gap-3">
            {index > 0 && <Button variant="outline" onClick={() => go(steps[index - 1])}>{t('common.previous')}</Button>}
            {index < steps.length - 1 && <Button onClick={() => go(steps[index + 1])}>{t('common.next')}</Button>}
            {current === 'review' && !blocked && (
              <Button asChild><Link to="export">{t('cfg.toExport')}</Link></Button>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-4" aria-label={t('preview.title')}>
          <div className="h-80 lg:h-[30rem]">
            <ViewerBoundary fallback={<p role="alert">{t('preview.loadFailed')}</p>}>
              <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
                <MaskViewer config={config} label={t('preview.title')} />
              </Suspense>
            </ViewerBoundary>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="outline" asChild><Link to="preview">{t('cfg.toPreview')}</Link></Button>
            {role === 'owner' && <Button variant="outline" asChild><Link to="collaborators">{t('cfg.toCollab')}</Link></Button>}
          </div>
        </aside>
      </div>
    </div>
  )
}
