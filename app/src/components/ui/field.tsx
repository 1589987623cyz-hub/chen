import * as LabelPrimitive from '@radix-ui/react-label'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const control =
  'min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink disabled:cursor-not-allowed disabled:opacity-60'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('block font-medium', className)} {...props} />
}

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function TextField({ label, hint, error, className, ...props }: FieldProps & ComponentProps<'input'>) {
  const id = useId()
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {hint && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      <input
        id={id}
        className={cn(control, 'mt-1', error && 'border-2 border-danger')}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">{error}</p>}
    </div>
  )
}

export function SelectField({ label, hint, className, children, ...props }: FieldProps & ComponentProps<'select'>) {
  const id = useId()
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {hint && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      <select
        id={id}
        className={cn(control, 'mt-1')}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

interface SwitchFieldProps {
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (value: boolean) => void
}

export function SwitchField({ label, hint, checked, disabled, onCheckedChange }: SwitchFieldProps) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      </div>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="relative h-7 w-12 shrink-0 rounded-full border-2 border-line bg-soft data-[state=checked]:bg-accent disabled:opacity-60"
      >
        <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-accent-ink" />
      </SwitchPrimitive.Root>
    </div>
  )
}
