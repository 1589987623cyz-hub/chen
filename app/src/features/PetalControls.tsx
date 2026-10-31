import { useMemo, useState, type ReactNode } from 'react'
import { tintOf } from '@exsense/reference/maskGeometry.js'
import { Button } from '@/components/ui/button'
import {
  defaultLook,
  IDLE_MODES,
  PALETTE_IDS,
  PALETTES,
  PRESS_PATTERNS,
  SCENE_IDS,
  SCENES,
  SECTORS,
  SHELL_COLORS,
  SHELL_IDS,
  TRAVEL_RANGE,
  ZONE_IDS,
  type Config,
  type IdleMode,
  type PaletteId,
  type PetalLook,
  type PressPattern,
  type Sector,
  type ZoneId,
} from '@/domain/params'
import { weakSectors } from '@/domain/validate'
import { contacts, maskParams, tiles } from '@/geometry/mask'
import { useI18n } from '@/i18n'
import { pressTravel, wantedTravel } from '@/scene/feedback'
import { Note, Section, Segmented, SelectField, SliderField, SwitchField } from './shared'

const swatch = 'grid min-h-11 cursor-pointer place-items-center gap-1 rounded-xl border-2 p-2 text-sm'

function PaletteChip({ id }: { id: PaletteId }) {
  return (
    <span aria-hidden="true" className="flex">
      {PALETTES[id].slice(0, 4).map((color) => (
        <span key={color} className="-ms-1 size-5 rounded-full border border-surface first:ms-0" style={{ background: color }} />
      ))}
    </span>
  )
}

export function LookPanel({ look, pro, onChange }: { look: PetalLook; pro: boolean; onChange: (patch: Partial<PetalLook>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-5">
      <Section title={t('look.scene')} hint={t('look.sceneHint')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCENE_IDS.map((id) => (
            <Button key={id} variant="outline" onClick={() => onChange(SCENES[id])}>{t(`scene.${id}`)}</Button>
          ))}
        </div>
      </Section>

      <Section title={t('look.palette')} hint={t('look.paletteHint')}>
        <div role="group" aria-label={t('look.palette')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PALETTE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={look.palette === id}
              className={`${swatch} ${look.palette === id ? 'border-accent bg-soft font-semibold' : 'border-line bg-surface hover:bg-soft'}`}
              onClick={() => onChange({ palette: id })}
            >
              <PaletteChip id={id} />
              {t(`palette.${id}`)}
            </button>
          ))}
        </div>
      </Section>

      {pro && (
        <Section title={t('look.surface')}>
          <SliderField label={t('look.strength')} value={look.strength} min={0} max={100} unit="%" onChange={(strength) => onChange({ strength })} />
          <SliderField label={t('look.opacity')} hint={t('look.opacityHint')} value={look.opacity} min={60} max={100} unit="%" onChange={(opacity) => onChange({ opacity })} />
        </Section>
      )}

      <Section title={t('look.pose')} hint={t('look.poseHint')}>
        <SliderField label={t('look.bloom')} value={look.bloom} min={0} max={100} unit="%" onChange={(bloom) => onChange({ bloom })} />
        {pro && (
          <>
            <SliderField label={t('look.stagger')} hint={t('look.staggerHint')} value={look.stagger} min={0} max={100} unit="%" onChange={(stagger) => onChange({ stagger })} />
            <SliderField label={t('look.sway')} hint={t('look.swayHint')} value={look.sway} min={-100} max={100} step={5} unit="%" onChange={(sway) => onChange({ sway })} />
            <SliderField label={t('look.size')} value={look.size} min={85} max={115} unit="%" onChange={(size) => onChange({ size })} />
          </>
        )}
      </Section>

      {pro && <FineLook look={look} onChange={onChange} />}

      <Button variant="outline" onClick={() => onChange(defaultLook())}>{t('look.reset')}</Button>
    </div>
  )
}

function FineLook({ look, onChange }: { look: PetalLook; onChange: (patch: Partial<PetalLook>) => void }) {
  const { t } = useI18n()
  const setZone = (zone: (typeof ZONE_IDS)[number], palette: string) => {
    const next = { ...look.zonePalette }
    if (palette) next[zone] = palette as PaletteId
    else delete next[zone]
    onChange({ zonePalette: next })
  }
  return (
    <>
      <Section title={t('look.idle')} hint={t('look.idleHint')}>
        <Segmented<IdleMode>
          label={t('look.idle')}
          value={look.idle}
          onChange={(idle) => onChange({ idle })}
          options={IDLE_MODES.map((m) => ({ value: m, label: t(`idle.${m}`) }))}
        />
        {look.idle !== 'none' && (
          <>
            <SliderField label={t('look.idleSpeed')} value={look.idleSpeed} min={20} max={200} step={10} unit="%" onChange={(idleSpeed) => onChange({ idleSpeed })} />
            <SliderField label={t('look.idleDepth')} value={look.idleDepth} min={10} max={100} step={5} unit="%" onChange={(idleDepth) => onChange({ idleDepth })} />
          </>
        )}
      </Section>

      <Section title={t('look.trim')} hint={t('look.trimHint')}>
        <SwitchField label={t('look.rim')} checked={look.rim} onCheckedChange={(rim) => onChange({ rim })} />
        <SwitchField label={t('look.veins')} checked={look.veins} onCheckedChange={(veins) => onChange({ veins })} />
        <SwitchField label={t('look.beads')} checked={look.beads} onCheckedChange={(beads) => onChange({ beads })} />
      </Section>

      <Section title={t('look.shell')}>
        <div role="group" aria-label={t('look.shell')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SHELL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={look.shell === id}
              className={`${swatch} ${look.shell === id ? 'border-accent bg-soft font-semibold' : 'border-line bg-surface hover:bg-soft'}`}
              onClick={() => onChange({ shell: id })}
            >
              <span aria-hidden="true" className="size-5 rounded-full border border-line" style={{ background: SHELL_COLORS[id] }} />
              {t(`shell.${id}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('look.zones')} hint={t('look.zonesHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {ZONE_IDS.map((zone) => (
            <div key={zone} className="grid gap-1">
              <SelectField label={t(`place.${zone}`)} value={look.zonePalette[zone] ?? ''} onChange={(e) => setZone(zone, e.target.value)}>
                <option value="">{t('look.followAll')}</option>
                {PALETTE_IDS.map((id) => <option key={id} value={id}>{t(`palette.${id}`)}</option>)}
              </SelectField>
              <SelectField
                label={t('look.zoneBloom', { zone: t(`place.${zone}`) })}
                value={look.zoneBloom[zone] ?? ''}
                onChange={(e) => {
                  const next = { ...look.zoneBloom }
                  if (e.target.value === '') delete next[zone]
                  else next[zone] = Number(e.target.value)
                  onChange({ zoneBloom: next })
                }}
              >
                <option value="">{t('look.followAll')}</option>
                {[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}%</option>)}
              </SelectField>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

/** A flat map of all 96 petals. The list beside it reaches the same petals from a keyboard or screen reader. */
export function PetalMap({ config, selected, onSelect }: { config: Config; selected: string | null; onSelect: (id: string | null) => void }) {
  const paths = useMemo(
    () =>
      [...tiles]
        .sort((a, b) => a.petal.rank - b.petal.rank)
        .map((tile) => ({ tile, d: `M${tile.outlineUV.filter((_, i) => i % 3 === 0).map(([u, v]) => `${u.toFixed(1)},${(-v).toFixed(1)}`).join('L')}Z` })),
    [],
  )
  return (
    <svg viewBox="-122 -136 244 262" aria-hidden="true" className="mx-auto max-h-80 w-full">
      {paths.map(({ tile, d }) => {
        const muted = config.motion.muted.includes(tile.id)
        const off = !config.enabledZones.includes(tile.zone)
        const palette = PALETTES[config.look.zonePalette[tile.zone] ?? config.look.palette]
        return (
          <path
            key={tile.id}
            d={d}
            className="cursor-pointer"
            fill={muted || off ? 'var(--soft)' : tintOf(tile.petal, palette)}
            stroke={tile.id === selected ? 'var(--accent)' : 'var(--gold)'}
            strokeWidth={tile.id === selected ? 2.2 : 0.5}
            strokeDasharray={muted ? '2 2' : undefined}
            onClick={() => onSelect(tile.id === selected ? null : tile.id)}
          />
        )
      })}
    </svg>
  )
}

type GroupId = '' | `zone:${ZoneId}` | `sector:${Sector}`

const groupMembers = (group: GroupId) => {
  if (group.startsWith('zone:')) return tiles.filter((x) => x.zone === group.slice(5)).map((x) => x.id)
  if (group.startsWith('sector:')) return tiles.filter((x) => x.sector === group.slice(7)).map((x) => x.id)
  return []
}

interface MotionPanelProps {
  config: Config
  locked: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  onPress: (ids: string[]) => void
  onChange: (patch: Partial<Config['motion']>) => void
  children: ReactNode
}

export function MotionPanel({ config, locked, selected, onSelect, onPress, onChange, children }: MotionPanelProps) {
  const { t } = useI18n()
  const pro = config.mode === 'pro'
  const { travel, muted, zoneTravel, pattern, stepMs } = config.motion
  const [group, setGroup] = useState<GroupId>('')
  const members = groupMembers(group)
  const tile = tiles.find((x) => x.id === selected)
  const solo = tile ? pressTravel(config, [tile.id]).get(tile.id)! : 0
  const groupMuted = members.filter((id) => muted.includes(id)).length
  const contact = contacts.find((c) => c.tile === selected)
  const isMuted = !!tile && muted.includes(tile.id)
  const weak = weakSectors(config)
  return (
    <div className="grid gap-5">
      {locked && <Note>{t('motion.helperNote')}</Note>}
      {children}
      <Section title={t('motion.travel')} hint={t('motion.travelHint', { max: maskParams.tiles.travelIn })}>
        <SliderField
          label={t('motion.travelLabel')}
          value={travel}
          min={TRAVEL_RANGE.min}
          max={TRAVEL_RANGE.max}
          step={TRAVEL_RANGE.step}
          unit=" mm"
          disabled={locked}
          onChange={(value) => onChange({ travel: value })}
        />
        <p className="text-sm text-muted">{t('motion.press', { mm: (travel - maskParams.contacts.tipGap).toFixed(1) })}</p>
        {pro && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('motion.zoneTravel')}</summary>
            <div className="grid gap-3 sm:grid-cols-2">
              {ZONE_IDS.map((zone) => (
                <SelectField
                  key={zone}
                  label={t(`place.${zone}`)}
                  disabled={locked}
                  value={zoneTravel[zone] ?? ''}
                  onChange={(e) => {
                    const next = { ...zoneTravel }
                    if (e.target.value === '') delete next[zone]
                    else next[zone] = Number(e.target.value)
                    onChange({ zoneTravel: next })
                  }}
                >
                  <option value="">{t('look.followAll')}</option>
                  {[0.6, 0.8, 1, 1.2, 1.5].map((n) => <option key={n} value={n}>{n} mm</option>)}
                </SelectField>
              ))}
            </div>
          </details>
        )}
      </Section>

      {pro && (
        <>
          <Section title={t('motion.pattern')} hint={t('motion.patternHint')}>
            <Segmented<PressPattern>
              label={t('motion.pattern')}
              value={pattern}
              onChange={(next) => !locked && onChange({ pattern: next })}
              options={PRESS_PATTERNS.map((p) => ({ value: p, label: t(`pattern.${p}`) }))}
            />
            {pattern === 'cascade' && (
              <SliderField label={t('motion.step')} value={stepMs} min={20} max={200} step={10} unit=" ms" disabled={locked} onChange={(value) => onChange({ stepMs: value })} />
            )}
          </Section>

          <Section title={t('motion.group')} hint={t('motion.groupHint')}>
            <SelectField label={t('motion.groupPick')} value={group} onChange={(e) => setGroup(e.target.value as GroupId)}>
              <option value="">{t('motion.none')}</option>
              <optgroup label={t('motion.byZone')}>
                {ZONE_IDS.map((z) => <option key={z} value={`zone:${z}`}>{t(`place.${z}`)}</option>)}
              </optgroup>
              <optgroup label={t('motion.bySector')}>
                {SECTORS.map((s) => <option key={s} value={`sector:${s}`}>{t(`sector.${s}`)}</option>)}
              </optgroup>
            </SelectField>
            {members.length > 0 && (
              <>
                <p className="text-sm text-muted">{t('motion.groupCount', { n: members.length, muted: groupMuted })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onPress(members.filter((id) => !muted.includes(id)))}>{t('motion.testGroup')}</Button>
                  <Button variant="outline" disabled={locked || groupMuted === members.length} onClick={() => onChange({ muted: [...new Set([...muted, ...members])] })}>{t('motion.muteGroup')}</Button>
                  <Button variant="outline" disabled={locked || groupMuted === 0} onClick={() => onChange({ muted: muted.filter((id) => !members.includes(id)) })}>{t('motion.unmuteGroup')}</Button>
                </div>
              </>
            )}
          </Section>

          <Section title={t('motion.pick')} hint={t('motion.pickHint')}>
            <PetalMap config={config} selected={selected} onSelect={onSelect} />
            <SelectField label={t('motion.list')} value={selected ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
              <option value="">{t('motion.none')}</option>
              {ZONE_IDS.map((zone) => (
                <optgroup key={zone} label={t(`place.${zone}`)}>
                  {tiles.filter((x) => x.zone === zone).map((x) => (
                    <option key={x.id} value={x.id}>{x.id} · {t(`sector.${x.sector}`)}</option>
                  ))}
                </optgroup>
              ))}
            </SelectField>

            {tile && (
              <div className="grid gap-3 rounded-xl border border-line p-3" aria-live="polite">
                <h4 className="font-semibold">{t('motion.selected', { id: tile.id })}</h4>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">{t('motion.zone')}</dt>
                  <dd>{t(`place.${tile.zone}`)}</dd>
                  <dt className="text-muted">{t('motion.sector')}</dt>
                  <dd>{t(`sector.${tile.sector}`)}</dd>
                  <dt className="text-muted">{t('motion.contact')}</dt>
                  <dd>
                    {contact
                      ? t(contact.thermal ? 'motion.contactThermal' : 'motion.contactTouch', { mm: contact.length.toFixed(1) })
                      : t('motion.contactNone')}
                  </dd>
                  <dt className="text-muted">{t('motion.solo')}</dt>
                  <dd>{t(solo < wantedTravel(config, tile) - 0.01 ? 'motion.soloHeld' : 'motion.soloFree', { mm: solo.toFixed(2) })}</dd>
                  <dt className="text-muted">{t('motion.state')}</dt>
                  <dd>{t(isMuted ? 'motion.isMuted' : config.enabledZones.includes(tile.zone) ? 'motion.isLive' : 'motion.isZoneOff')}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onPress([tile.id])}>{t('motion.test')}</Button>
                  <Button
                    variant="outline"
                    disabled={locked}
                    onClick={() => onChange({ muted: isMuted ? muted.filter((id) => id !== tile.id) : [...muted, tile.id] })}
                  >
                    {t(isMuted ? 'motion.unmute' : 'motion.mute')}
                  </Button>
                </div>
              </div>
            )}
          </Section>
        </>
      )}

      {muted.length > 0 && (
        <Section title={t('motion.mutedTitle', { n: muted.length })}>
          {config.cues.space && weak.length > 0 && (
            <p className="text-warn">{t('motion.weak', { sectors: weak.map((s) => t(`sector.${s}`)).join(t('common.list')) })}</p>
          )}
          <Button variant="outline" disabled={locked} onClick={() => onChange({ muted: [] })}>{t('motion.unmuteAll')}</Button>
        </Section>
      )}
    </div>
  )
}
