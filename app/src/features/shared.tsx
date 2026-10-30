import { useEffect, useRef, type ReactNode } from 'react'
import { SelectField, SwitchField, TextField } from '@/components/ui/field'
import { paramByKey, type NumericKey } from '@/domain/params'
import type { Issue } from '@/domain/validate'
import { useI18n, type Translate } from '@/i18n'
import { useConfig } from './ConfigContext'

export function PageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <h1 ref={ref} tabIndex={-1} className="font-serif text-3xl font-semibold outline-none">
      {children}
    </h1>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

export function unitLabel(t: Translate, unit: string) {
  return unit === 'pcs' || unit === 'level' ? t(`unit.${unit}`) : unit
}

export function issueText(t: Translate, issue: Issue) {
  const args = { ...issue.args }
  if (issue.code === 'openZone') {
    args.zone = t(`zone.${args.zone}`)
    if (args.part === 'upper' || args.part === 'lower') args.part = t(`part.${args.part}`)
  }
  if (issue.code === 'range') args.unit = unitLabel(t, String(args.unit))
  return t(`issue.${issue.code}`, args)
}

export function NumberField({ name, disabled }: { name: NumericKey; disabled?: boolean }) {
  const { t } = useI18n()
  const { config, issues, setValue } = useConfig()
  const param = paramByKey[name]
  const unit = unitLabel(t, param.unit)
  const issue = issues.find((i) => i.field === name && i.severity === 'error')
  return (
    <TextField
      type="number"
      inputMode="decimal"
      label={t('param.label', { name: t(`param.${name}`), unit })}
      hint={t('param.range', { min: param.min, max: param.max, unit })}
      min={param.min}
      max={param.max}
      step={param.step}
      value={Number.isNaN(config.values[name]) ? '' : config.values[name]}
      disabled={disabled}
      error={issue ? issueText(t, issue) : undefined}
      onChange={(e) => setValue(name, e.target.value === '' ? NaN : Number(e.target.value))}
    />
  )
}

export { SelectField, SwitchField, TextField }
