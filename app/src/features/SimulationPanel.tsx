import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SECTORS, type Config, type Sector } from '@/domain/params'
import { useI18n, type Translate } from '@/i18n'
import { heldBack, type Simulation, type SimulationKind, type SimulationResult } from '@/scene/feedback'
import { Note, Segmented, SelectField, TextField } from './shared'

export const INITIAL_SIMULATION: Simulation = { kind: 'space', sector: 'top', distance: 1.5, pm: 100, uv: 8 }

function describe(t: Translate, config: Config, sim: Simulation, result: SimulationResult) {
  const { thermal, tap } = config.cues
  const cue = (cool: boolean) => {
    if (thermal && tap) return t(cool ? 'sim.coolTap' : 'sim.warmTap')
    if (thermal) return t(cool ? 'sim.cool' : 'sim.warm')
    return t(cool ? 'sim.tap2' : 'sim.tap1')
  }
  if (sim.kind === 'rest') return t('sim.rest')
  if (sim.kind === 'air') return result.state.kind === 'air' ? t('sim.airOn', { cue: cue(true) }) : t('sim.airOff')
  if (sim.kind === 'uv') return result.state.kind === 'uv' ? t('sim.uvOn', { cue: cue(false) }) : t('sim.uvOff')
  if (result.tier === 'none') return t('sim.none')
  if (!result.tileCount) return t('sim.blocked')
  const pattern = result.tier === 'hold' ? t('sim.hold') : t(result.tier === 'slow' ? 'sim.slow' : 'sim.fast', { hz: result.pulseHz })
  const line = t('sim.sector', { sector: t(`sector.${sim.sector}`), count: result.tileCount, mm: config.motion.travel, pattern })
  const held = heldBack(config, sim.sector)
  return held ? `${line} ${t('sim.held', { n: held })}` : line
}

const MODES: SimulationKind[] = ['rest', 'space', 'air', 'uv']

interface SimulationPanelProps {
  config: Config
  sim: Simulation
  result: SimulationResult
  onChange: (sim: Simulation) => void
}

export function SimulationPanel({ config, sim, result, onChange }: SimulationPanelProps) {
  const { t } = useI18n()
  const [sweeping, setSweeping] = useState(false)

  useEffect(() => {
    if (!sweeping) return
    const timer = setInterval(() => {
      onChange({ ...sim, kind: 'space', sector: SECTORS[(SECTORS.indexOf(sim.sector) + 1) % SECTORS.length] })
    }, 1400)
    return () => clearInterval(timer)
  }, [sweeping, sim, onChange])

  return (
    <div className="grid gap-4">
      <Segmented
        label={t('preview.state')}
        value={sim.kind}
        onChange={(kind) => {
          setSweeping(false)
          onChange({ ...sim, kind })
        }}
        options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}
      />
      {sim.kind === 'space' && (
        <>
          <SelectField label={t('sim.direction')} value={sim.sector} onChange={(e) => onChange({ ...sim, sector: e.target.value as Sector })}>
            {SECTORS.map((s) => <option key={s} value={s}>{t(`sector.${s}`)}</option>)}
          </SelectField>
          <TextField label={t('sim.distance')} type="number" min={0.1} max={5} step={0.1} value={sim.distance} onChange={(e) => onChange({ ...sim, distance: Number(e.target.value) })} />
          <Button variant="outline" aria-pressed={sweeping} onClick={() => setSweeping(!sweeping)}>
            {t(sweeping ? 'sim.sweepStop' : 'sim.sweep')}
          </Button>
        </>
      )}
      {sim.kind === 'air' && (
        <TextField label={t('sim.pm')} type="number" min={0} max={500} value={sim.pm} onChange={(e) => onChange({ ...sim, pm: Number(e.target.value) })} />
      )}
      {sim.kind === 'uv' && (
        <TextField label={t('sim.uv')} type="number" min={0} max={15} value={sim.uv} onChange={(e) => onChange({ ...sim, uv: Number(e.target.value) })} />
      )}
      <Note>
        <h3 className="font-semibold">{t('sim.result')}</h3>
        <p aria-live="polite">{describe(t, config, sim, result)}</p>
        <p className="mt-2 text-sm text-muted">{t('sim.priority')}</p>
      </Note>
    </div>
  )
}
