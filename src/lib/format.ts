// Indian-style money: ₹85 L, ₹1.25 Cr
export function inr(v: number | string | null | undefined, opts: { exact?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (opts.exact) return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  const a = Math.abs(n)
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '')
  if (a >= 1e7) return `₹${trim(n / 1e7)} Cr`
  if (a >= 1e5) return `₹${trim(n / 1e5)} L`
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export function budgetRange(min: number | string | null, max: number | string | null): string {
  if (min && max) return `${inr(min)} – ${inr(max)}`
  if (max) return `up to ${inr(max)}`
  if (min) return `${inr(min)}+`
  return '—'
}

const IST = 'Asia/Kolkata'
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST }) : '—'
export const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: IST }) : '—'
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: IST }) : '—'

export function timeAgo(ts: string | Date): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : fmtDate(ts)
}

/** value for <input type="datetime-local"> in the browser's local zone */
export function toLocalInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  const x = new Date(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`
}
export const todayStr = () => toLocalInput(new Date()).slice(0, 10)

export function isOverdue(d: string | null | undefined): boolean {
  return !!d && new Date(d).getTime() < Date.now()
}

// ---------- lead stages ----------
export const STAGES = [
  { key: 'new', label: 'New', tone: 'neutral', color: '#25C281' },
  { key: 'contacted', label: 'Contacted', tone: 'gold', color: '#C08A25' },
  { key: 'qualified', label: 'Qualified', tone: 'gold', color: '#9C6E17' },
  { key: 'visit_scheduled', label: 'Visit Scheduled', tone: 'warn', color: '#8B5CF6' },
  { key: 'visit_done', label: 'Visit Done', tone: 'warn', color: '#6D4AD8' },
  { key: 'negotiation', label: 'Negotiation', tone: 'navy', color: '#0B1F3A' },
  { key: 'booked', label: 'Booked', tone: 'ok', color: '#0F7A44' },
  { key: 'lost', label: 'Lost', tone: 'bad', color: '#D64545' },
] as const
export type StageKey = (typeof STAGES)[number]['key']
export const stageOf = (k: string) => STAGES.find((s) => s.key === k) ?? STAGES[0]

/** Converts "85", "85L", "1.2cr", "8500000" to rupees. */
export function parseMoney(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/[₹,\s]/g, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|lakhs|k)?$/)
  if (!m) return NaN
  const n = parseFloat(m[1])
  const unit = m[2]
  if (unit?.startsWith('c')) return Math.round(n * 1e7)
  if (unit?.startsWith('l')) return Math.round(n * 1e5)
  if (unit === 'k') return Math.round(n * 1e3)
  return n < 1000 ? Math.round(n * 1e5) : Math.round(n) // bare "85" means 85 lakh
}

