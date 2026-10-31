import { useEffect, useRef, type ReactNode } from 'react'
import { SelectField, SliderField, SwitchField, TextField } from '@/components/ui/field'
import { paramByKey, type NumericKey } from '@/domain/params'
import type { Issue } from '@/domain/validate'
import { useI18n, type Translate } from '@/i18n'
import { useConfig } from './ConfigContext'

export function PageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <h1 ref={ref} tabIndex={-1} className="gold-rule font-serif text-3xl font-semibold outline-none sm:text-4xl">
      {children}
    </h1>
  )
}

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3 grid gap-4">{children}</div>
    </section>
  )
}

/** A quiet panel for notes and results. */
export function Note({ tone = 'soft', children }: { tone?: 'soft' | 'sage'; children: ReactNode }) {
  return <div className={`rounded-xl p-3 ${tone === 'sage' ? 'bg-sage text-sage-ink' : 'bg-soft'}`}>{children}</div>
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

/** A row of choices where exactly one is on. Native radio buttons, so arrow keys and screen readers just work. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-1 rounded-3xl border border-line bg-surface p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-9 cursor-pointer items-center rounded-full px-3 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${value === option.value ? 'bg-accent font-medium text-accent-ink' : 'hover:bg-soft'}`}
          >
            <input type="radio" name={label} className="sr-only" checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function unitLabel(t: Translate, unit: string) {
  return unit === 'pcs' || unit === 'level' ? t(`unit.${unit}`) : unit
}

export function issueText(t: Translate, issue: Issue) {
  const args = { ...issue.args }
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

export { SelectField, SliderField, SwitchField, TextField }
