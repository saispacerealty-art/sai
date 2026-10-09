import { X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type ComponentType,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cx } from '../lib/cx'


// ---------- Button ----------
type Variant = 'primary' | 'gold' | 'ghost' | 'danger' | 'outline'
const variants: Record<Variant, string> = {
  primary: 'bg-navy text-gold-light hover:bg-navy-dark',
  gold: 'bg-gold text-navy-dark hover:bg-gold-dark hover:text-white',
  ghost: 'bg-transparent text-ink-dim hover:bg-col hover:text-ink',
  danger: 'bg-bad text-white hover:opacity-90',
  outline: 'border border-line bg-panel text-ink hover:bg-col',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <output
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className ?? 'size-5')}
    />
  )
}

// ---------- Form fields ----------
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-ink-dim">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-ink-faint">{hint}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:bg-col'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} className={cx(inputCls, className)} />
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(inputCls, 'pr-8', className)}>
      {children}
    </select>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  note,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  note?: string
}) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
      <input
        type="checkbox"
        className="size-4 accent-navy"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
      {note && <span className="text-[10px] font-semibold uppercase text-gold-dark">{note}</span>}
    </label>
  )
}

// ---------- Modal (native <dialog>: focus trap + Esc for free) ----------
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cx(
        'm-auto max-h-[92vh] w-[calc(100%-2rem)] overflow-auto rounded-2xl bg-panel p-0 shadow-2xl backdrop:bg-navy-dark/60',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-navy">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-dim hover:bg-col" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

// ---------- Badge ----------
type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'gold' | 'navy'
const tones: Record<Tone, string> = {
  neutral: 'bg-col text-ink-dim',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  gold: 'bg-gold-tint text-gold-dark',
  navy: 'bg-navy text-gold-light',
}
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  )
}

export function Alert({ tone = 'bad', children }: { tone?: 'bad' | 'warn' | 'ok'; children: ReactNode }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx('rounded-lg px-3 py-2 text-sm', tone === 'bad' ? 'bg-bad-bg text-bad' : tone === 'warn' ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok')}
    >
      {children}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-panel p-4 sm:p-5', className)}>{children}</div>
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy sm:text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------- Textarea ----------
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(inputCls, 'min-h-20 resize-y', className)} />
}

// ---------- Side drawer (detail panels) ----------
export function Drawer({ open, title, subtitle, onClose, children, footer }: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-xl bg-panel p-0 shadow-2xl backdrop:bg-navy-dark/60"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-navy">{title}</h2>
              {subtitle && <div className="mt-0.5 text-sm text-ink-dim">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-dim hover:bg-col" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

// ---------- Small building blocks ----------
export function EmptyState({ icon: Icon, title, hint, action }: { icon: ComponentType<{ className?: string }>; title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="py-12 text-center">
      <Icon className="mx-auto size-10 text-gold" />
      <p className="mt-3 font-semibold text-navy">{title}</p>
      {hint && <p className="mx-auto max-w-sm text-sm text-ink-dim">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  )
}

export function Stat({ icon: Icon, label, value, sub, tone }: { icon: ComponentType<{ className?: string }>; label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-panel p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold-tint text-gold-dark">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold text-ink-dim">{label}</div>
        <div className="truncate text-xl font-bold text-navy">{value}</div>
        {sub && <div className={cx('text-[11px] font-semibold', tone === 'bad' ? 'text-bad' : 'text-ink-faint')}>{sub}</div>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-col p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx('rounded-md px-3 py-1.5 text-[13px] font-semibold', value === t.key ? 'bg-navy text-gold-light' : 'text-ink-dim hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Loading() {
  return (
    <div className="grid place-items-center py-16 text-navy">
      <Spinner />
    </div>
  )
}

export function Table({ head, children, minWidth = 720 }: { head: ReactNode; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="bg-canvas text-[11px] tracking-wide text-ink-faint uppercase">{head}</thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line">{children}</tbody>
      </table>
    </div>
  )
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={cx('px-4 py-3 font-semibold', right && 'text-right')}>{children}</th>
)
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cx('px-4 py-3 align-middle', right && 'text-right', className)}>{children}</td>
)
