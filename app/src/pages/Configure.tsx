import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { NUMERIC_PARAMS, SIZE_PRESETS, ZONE_IDS, type Mode, type NumericKey, type PetalLook, type SizePreset, type ZoneId } from '@/domain/params'
import { encodeShare } from '@/domain/share'
import { estimateMass, hasBlockingIssue, hiddenProSettings } from '@/domain/validate'
import { useConfig } from '@/features/ConfigContext'
import { MaskStage } from '@/features/MaskStage'
import { LookPanel, MotionPanel } from '@/features/PetalControls'
import { issueText, Note, NumberField, PageTitle, Section, Segmented, SelectField, SwitchField, TextField } from '@/features/shared'
import { INITIAL_SIMULATION, SimulationPanel } from '@/features/SimulationPanel'
import { tiles } from '@/geometry/mask'
import { useI18n } from '@/i18n'
import { resolveSimulation, REST, type Simulation } from '@/scene/feedback'
import { ShareControl } from './Preview'

const keysOf = (group: string, mode?: 'simple' | 'pro') =>
  NUMERIC_PARAMS.filter((p) => p.group === group && (!mode || p.mode === mode)).map((p) => p.key as NumericKey)

const TABS = ['look', 'motion', 'fit', 'feedback', 'review'] as const
type Tab = (typeof TABS)[number]

function FitPanel({ onHighlight }: { onHighlight: (zone: ZoneId | null) => void }) {
  const { t } = useI18n()
  const { config, issues, update } = useConfig()
  const toggle = (zone: ZoneId, on: boolean) =>
    update({ enabledZones: on ? [...config.enabledZones, zone] : config.enabledZones.filter((z) => z !== zone) })
  const measures = (
    <div className="grid gap-4 sm:grid-cols-2">
      {keysOf('measure').map((key) => <NumberField key={key} name={key} />)}
    </div>
  )
  const needsMeasures = config.sizePreset === 'custom' || issues.some((i) => i.field && keysOf('measure').includes(i.field))
  return (
    <div className="grid gap-5">
      <Section title={t('zones.title')} hint={t('zones.lead')}>
        <div className="grid gap-1">
          {ZONE_IDS.map((zone) => (
            <div key={zone} onMouseEnter={() => onHighlight(zone)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(zone)} onBlur={() => onHighlight(null)}>
              <SwitchField
                label={`${t(`place.${zone}`)} · ${t('zones.count', { n: tiles.filter((x) => x.zone === zone).length })}`}
                checked={config.enabledZones.includes(zone)}
                onCheckedChange={(on) => toggle(zone, on)}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section title={t('size.title')} hint={t('size.lead')}>
        <Note>{t('size.fixedModel')}</Note>
        <SelectField
          label={t('size.preset')}
          value={config.sizePreset}
          onChange={(e) => {
            const size = e.target.value as SizePreset | 'custom'
            if (size !== 'custom') update({ sizePreset: size, values: { ...config.values, ...SIZE_PRESETS[size] } })
          }}
        >
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="custom" disabled={config.sizePreset !== 'custom'}>{t('size.custom')}</option>
        </SelectField>
        {config.mode === 'pro' ? measures : (
          <details open={needsMeasures}>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('size.manual')}</summary>
            {measures}
          </details>
        )}
      </Section>
    </div>
  )
}

/** A link anyone can open, without an account or a database. */
function CopyLink() {
  const { t } = useI18n()
  const { config } = useConfig()
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState('')
  const copy = async () => {
    const link = `${location.origin}${import.meta.env.BASE_URL}start#${encodeShare(config)}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setFallback('')
    } catch {
      setFallback(link)
    }
  }
  return (
    <div className="grid gap-1">
      <Button variant="outline" onClick={copy}>{t('link.copy')}</Button>
      <p role="status" className="text-sm text-muted">{copied ? t('link.copied') : ''}</p>
      {fallback && <p className="max-w-md text-sm break-all">{fallback}</p>}
    </div>
  )
}

const FEEDBACK_PRESETS: Record<string, Partial<Record<NumericKey, number>>> = {
  gentle: { hapticLevel: 2, thermalLevel: 1, cueDuration: 1.5 },
  balanced: { hapticLevel: 3, thermalLevel: 2, cueDuration: 2 },
  strong: { hapticLevel: 5, thermalLevel: 3, cueDuration: 3 },
}

function FeedbackPanel() {
  const { t } = useI18n()
  const { config, issues, role, update } = useConfig()
  const locked = role === 'helper'
  const pro = config.mode === 'pro'
  const fineKeys = keysOf('feedback', 'pro')
  const showFine = pro || issues.some((i) => i.field && fineKeys.includes(i.field))
  const setCue = (key: keyof typeof config.cues, on: boolean) => update({ cues: { ...config.cues, [key]: on }, feedbackConfirmed: false })
  return (
    <div className="grid gap-5">
      {locked && <Note>{t('cfg.helperNote')}</Note>}
      <Section title={t('fb.cues')} hint={t('fb.lead')}>
        {(['space', 'air', 'uv', 'thermal', 'tap'] as const).map((cue) => (
          <SwitchField key={cue} label={t(`cue.${cue}`)} checked={config.cues[cue]} disabled={locked} onCheckedChange={(on) => setCue(cue, on)} />
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
        {pro && ZONE_IDS.filter((z) => config.enabledZones.includes(z)).map((zone) => (
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
      {showFine && (
        <Section title={t('fb.distance')}>
          {fineKeys.map((key) => <NumberField key={key} name={key} disabled={locked} />)}
        </Section>
      )}
      <Note tone="sage">
        <SwitchField
          label={t('fb.confirm')}
          hint={t('fb.confirmHint')}
          checked={config.feedbackConfirmed}
          disabled={locked}
          onCheckedChange={(feedbackConfirmed) => update({ feedbackConfirmed })}
        />
      </Note>
    </div>
  )
}

function ReviewPanel({ onGo }: { onGo: (tab: Tab) => void }) {
  const { t } = useI18n()
  const { config, issues, role, update } = useConfig()
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const tabFor = (issue: (typeof issues)[number]): Tab => {
    if (!issue.field) return issue.code === 'travelRange' ? 'motion' : 'feedback'
    return NUMERIC_PARAMS.find((p) => p.key === issue.field)!.group === 'measure' ? 'fit' : 'feedback'
  }
  return (
    <div className="grid gap-5">
      <Section title={t('review.title')}>
        <p role="status" className={errors.length ? 'font-semibold text-danger' : 'font-semibold text-ok'}>
          {errors.length ? t('review.errors', { n: errors.length }) : t('review.ok')}
        </p>
        {errors.length > 0 && (
          <ul className="grid gap-2">
            {errors.map((issue, i) => {
              const tab = tabFor(issue)
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger p-3">
                  <span>{issue.field ? t('review.fieldIssue', { field: t(`param.${issue.field}`), issue: issueText(t, issue) }) : issueText(t, issue)}</span>
                  <Button variant="outline" onClick={() => onGo(tab)}>{t('review.goField', { step: t(`tab.${tab}`) })}</Button>
                </li>
              )
            })}
          </ul>
        )}
        {warnings.length > 0 && (
          <div>
            <h4 className="font-semibold">{t('review.warnings')}</h4>
            <ul className="list-disc ps-6">
              {warnings.map((issue, i) => <li key={i} className="text-warn">{issueText(t, issue)}</li>)}
            </ul>
          </div>
        )}
        <p>{t('review.mass', { g: estimateMass().toFixed(0) })}</p>
      </Section>
      {config.mode === 'pro' && (
        <Section title={t('struct.title')} hint={t('struct.lead')}>
          <SelectField label={t('struct.printPreset')} value={config.printPreset} onChange={(e) => update({ printPreset: e.target.value as typeof config.printPreset })}>
            <option value="fdm">{t('struct.fdm')}</option>
            <option value="service">{t('struct.service')}</option>
          </SelectField>
        </Section>
      )}
      <Section title={t('review.next')}>
        <div className="flex flex-wrap gap-3">
          {!hasBlockingIssue(issues) && <Button asChild><Link to="export">{t('cfg.toExport')}</Link></Button>}
          {role === 'owner' && <Button variant="outline" asChild><Link to="collaborators">{t('cfg.toCollab')}</Link></Button>}
        </div>
      </Section>
      {role === 'owner' && <ShareControl id={config.id} />}
    </div>
  )
}

export default function Configure() {
  const { t } = useI18n()
  const { config, role, issues, update } = useConfig()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'look'
  const panel = useRef<HTMLDivElement>(null)
  const tabs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const [sim, setSim] = useState<Simulation>({ ...INITIAL_SIMULATION, kind: 'rest' })
  const [selected, setSelected] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string[]>([])
  const [highlight, setHighlight] = useState<ZoneId | null>(null)
  const result = useMemo(() => resolveSimulation(config, sim), [config, sim])
  const simulating = tab === 'motion'
  const pro = config.mode === 'pro'
  const hidden = pro ? 0 : hiddenProSettings(config)

  const go = (next: Tab, focusPanel = true) => {
    setParams(next === 'look' ? {} : { tab: next }, { replace: true })
    if (focusPanel) requestAnimationFrame(() => panel.current?.focus())
  }

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]
    go(next, false)
    tabs.current[next]?.focus()
  }

  useEffect(() => {
    if (!pressed.length) return
    const timer = setTimeout(() => setPressed([]), 1400)
    return () => clearTimeout(timer)
  }, [pressed])

  const pick = (id: string | null) => {
    setSelected(id)
    if (id && tab !== 'motion') go('motion', false)
  }
  const press = (ids: string[]) => {
    setSim({ ...sim, kind: 'rest' })
    setPressed(ids)
  }
  const look = (patch: Partial<PetalLook>) => update({ look: { ...config.look, ...patch } })
  const blockers = issues.filter((i) => i.severity === 'error').length

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>{config.name}</PageTitle>
        <div className="flex flex-wrap items-start gap-3">
          <TextField label={t('cfg.name')} value={config.name} onChange={(e) => update({ name: e.target.value })} />
          <div className="pt-7"><CopyLink /></div>
        </div>
      </header>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented<Mode>
          label={t('cfg.modeLabel')}
          value={config.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { value: 'simple', label: t('cfg.modeSimple') },
            { value: 'pro', label: t('cfg.modePro') },
          ]}
        />
        <p className="text-sm text-muted">{t(pro ? 'cfg.modeProHint' : 'cfg.modeSimpleHint')}</p>
      </div>
      {role === 'helper' && <div className="mb-4"><Note>{t('cfg.helperNote')}</Note></div>}
      {hidden > 0 && <div className="mb-4"><Note>{t('cfg.hiddenPro', { n: hidden })}</Note></div>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(24rem,1fr)]">
        <aside className="lg:sticky lg:top-4" aria-label={t('preview.title')}>
          <MaskStage
            config={config}
            state={simulating ? result.state : REST}
            stateName={t(`mode.${simulating ? sim.kind : 'rest'}`)}
            pulseHz={simulating ? result.pulseHz : 0}
            highlightZone={highlight}
            selected={pro ? selected : null}
            pressed={pressed}
            onSelect={pro ? pick : undefined}
          />
        </aside>

        <section className="rounded-2xl border border-line bg-surface">
          <div role="tablist" aria-label={t('cfg.tabs')} onKeyDown={onTabKey} className="flex flex-wrap gap-1 border-b border-line p-2">
            {TABS.map((name) => (
              <button
                key={name}
                ref={(el) => { tabs.current[name] = el }}
                id={`tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls="tab-panel"
                tabIndex={tab === name ? 0 : -1}
                className={`min-h-11 rounded-full px-3 py-1.5 ${tab === name ? 'bg-accent font-medium text-accent-ink' : 'hover:bg-soft'}`}
                onClick={() => go(name)}
              >
                {t(`tab.${name}`)}
                {name === 'review' && blockers > 0 && <span className="ms-1 font-semibold">({blockers})</span>}
              </button>
            ))}
          </div>
          <div id="tab-panel" ref={panel} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="p-4 outline-none sm:p-5">
            {tab === 'look' && <LookPanel look={config.look} pro={pro} onChange={look} />}
            {tab === 'motion' && (
              <MotionPanel
                config={config}
                locked={role === 'helper'}
                selected={selected}
                onSelect={setSelected}
                onPress={press}
                onChange={(patch) => update({ motion: { ...config.motion, ...patch }, feedbackConfirmed: false })}
              >
                <Section title={t('motion.simulate')} hint={t('motion.simulateHint')}>
                  <SimulationPanel config={config} sim={sim} result={result} onChange={setSim} />
                </Section>
              </MotionPanel>
            )}
            {tab === 'fit' && <FitPanel onHighlight={setHighlight} />}
            {tab === 'feedback' && <FeedbackPanel />}
            {tab === 'review' && <ReviewPanel onGo={go} />}
          </div>
        </section>
      </div>
    </div>
  )
}
