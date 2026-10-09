import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Navigation } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Alert, EmptyState, Loading, PageHeader } from '../../components/ui'
import { cx } from '../../lib/cx'
import { rpc, useCompany } from '../../lib/data'
import { fmtTime, timeAgo } from '../../lib/format'
import { initials } from '../../lib/perms'
import { todayIST } from '../attendance/data'

interface Live {
  user_id: string
  full_name: string
  role_label: string
  lat: number
  lng: number
  accuracy_m: number | null
  recorded_at: string
  status: 'online' | 'idle' | 'offline'
  check_in_at: string
  check_out_at: string | null
}
const PUNE: [number, number] = [18.589, 73.7868]
const DOT = { online: 'bg-online', idle: 'bg-idle', offline: 'bg-offline' } as const
const TEXT = { online: 'text-ok', idle: 'text-warn', offline: 'text-ink-faint' } as const

// Marker built from CSS classes only (no HTML strings, no inline styles) — see index.css
const pin = (status: Live['status'], selected: boolean) =>
  L.divIcon({ className: cx('crm-pin', `crm-pin-${status}`, selected && 'crm-pin-selected'), iconSize: [18, 18], iconAnchor: [9, 9] })

export function TrackingPage() {
  const company = useCompany()
  const [selected, setSelected] = useState<string | null>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const trailLine = useRef<L.Polyline | null>(null)
  const fitted = useRef(false)

  const live = useQuery({ queryKey: ['live-locations'], queryFn: () => rpc<Live[]>('live_locations'), refetchInterval: 30_000 })
  const trail = useQuery({
    queryKey: ['trail', selected, todayIST()],
    enabled: !!selected,
    queryFn: () => rpc<{ lat: number; lng: number; recorded_at: string }[]>('location_trail', { p_user: selected, p_date: todayIST() }),
    refetchInterval: 60_000,
  })

  // create the map once
  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = L.map(mapEl.current, { zoomControl: true }).setView(PUNE, 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m)
    map.current = m
    const store = markers.current
    return () => {
      m.remove()
      map.current = null
      store.clear()
    }
  }, [])

  // office marker
  useEffect(() => {
    const c = company.data
    if (!map.current || !c?.office_lat || !c.office_lng) return
    const office = L.marker([Number(c.office_lat), Number(c.office_lng)], { icon: L.divIcon({ className: 'crm-pin crm-pin-office', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map.current)
    return () => void office.remove()
  }, [company.data])

  // sync markers with live data
  useEffect(() => {
    const m = map.current
    if (!m || !live.data) return
    const seen = new Set<string>()
    for (const p of live.data) {
      seen.add(p.user_id)
      const at: [number, number] = [Number(p.lat), Number(p.lng)]
      let mk = markers.current.get(p.user_id)
      if (!mk) {
        mk = L.marker(at, { title: p.full_name }).addTo(m)
        mk.on('click', () => setSelected(p.user_id))
        markers.current.set(p.user_id, mk)
      }
      mk.setLatLng(at)
      mk.setIcon(pin(p.status, p.user_id === selected))
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove()
        markers.current.delete(id)
      }
    }
    if (!fitted.current && live.data.length) {
      m.fitBounds(L.latLngBounds(live.data.map((p) => [Number(p.lat), Number(p.lng)] as [number, number])).pad(0.3), { maxZoom: 14 })
      fitted.current = true
    }
  }, [live.data, selected])

  // trail for the selected person
  useEffect(() => {
    trailLine.current?.remove()
    trailLine.current = null
    if (!map.current || !trail.data || trail.data.length < 2) return
    trailLine.current = L.polyline(trail.data.map((t) => [Number(t.lat), Number(t.lng)] as [number, number]), { className: 'crm-trail' }).addTo(map.current)
  }, [trail.data])

  function pick(p: Live) {
    setSelected(p.user_id)
    map.current?.flyTo([Number(p.lat), Number(p.lng)], 15, { duration: 0.6 })
  }
  const sel = live.data?.find((p) => p.user_id === selected)

  return (
    <>
      <PageHeader title="Live Tracking" sub="Where your checked-in team is right now. Locations update while the CRM is open on their phone." />
      {live.error && <div className="mb-3"><Alert>{(live.error as Error).message}</Alert></div>}
      <div className="grid gap-4 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[300px_1fr]">
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-panel p-2 lg:max-h-none">
          {live.isLoading ? (
            <Loading />
          ) : (live.data ?? []).length === 0 ? (
            <EmptyState icon={Navigation} title="Nobody is checked in" hint="People appear here after they check in on the Attendance page." />
          ) : (
            live.data!.map((p) => (
              <button
                type="button"
                key={p.user_id}
                onClick={() => pick(p)}
                className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-canvas', selected === p.user_id && 'bg-gold-tint')}
              >
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[#F3E3C0] text-xs font-bold text-navy">
                  {initials(p.full_name)}
                  <span className={cx('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-panel', DOT[p.status])} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.full_name}</span>
                  <span className="block truncate text-[11.5px] text-ink-dim">
                    {p.role_label} · seen {timeAgo(p.recorded_at)}
                  </span>
                </span>
                <span className={cx('text-[10.5px] font-bold capitalize', TEXT[p.status])}>{p.check_out_at ? 'left' : p.status}</span>
              </button>
            ))
          )}
        </div>
        <div className="relative h-[60dvh] overflow-hidden rounded-xl border border-line lg:h-auto">
          <div ref={mapEl} className="size-full" />
          {sel && (
            <div className="absolute top-3 left-14 z-[500] min-w-52 rounded-xl border border-line bg-panel px-4 py-3 shadow-lg">
              <p className="text-sm font-bold text-navy">{sel.full_name}</p>
              <p className="text-xs text-ink-dim">{sel.role_label}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-ink-faint">Status</dt>
                <dd className={cx('font-semibold capitalize', TEXT[sel.status])}>{sel.check_out_at ? 'Checked out' : sel.status}</dd>
                <dt className="text-ink-faint">Checked in</dt>
                <dd className="font-semibold text-ink">{fmtTime(sel.check_in_at)}</dd>
                <dt className="text-ink-faint">Last seen</dt>
                <dd className="font-semibold text-ink">{fmtTime(sel.recorded_at)}{sel.accuracy_m ? ` (±${Math.round(sel.accuracy_m)} m)` : ''}</dd>
                <dt className="text-ink-faint">Points today</dt>
                <dd className="font-semibold text-ink">{trail.data?.length ?? '…'}</dd>
              </dl>
            </div>
          )}
          <div className="absolute bottom-3 left-3 z-[500] flex gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[11.5px] text-ink-dim">
            {(['online', 'idle', 'offline'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5 capitalize">
                <span className={cx('size-2 rounded-full', DOT[s])} /> {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
