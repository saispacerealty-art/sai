import { Building2, Home, KeyRound, MapPin, TrendingUp, Warehouse } from 'lucide-react'
import { useMemo } from 'react'

// Animated night skyline from the Sample 1 login, generated instead of hard-coded.
// Animation delays are set via React style props (CSSOM), which a strict CSP allows.

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

const FILLS = ['#0b2347', '#0e2a52', '#081a33', '#0f2f5c', '#0a2044']

export function Skyline() {
  const buildings = useMemo(() => {
    const r = rng(42)
    const out: { x: number; y: number; w: number; fill: string; wins: { x: number; y: number; d: number; t: number }[] }[] = []
    let x = 0
    let i = 0
    while (x < 1200) {
      const w = 70 + Math.floor(r() * 40)
      const h = 110 + Math.floor(r() * 130)
      const y = 300 - h
      const wins = []
      for (let wy = y + 10; wy < 290; wy += 24)
        for (let wx = x + 10; wx < x + w - 14; wx += 22)
          if (r() > 0.55) wins.push({ x: wx, y: wy, d: +(r() * 6).toFixed(2), t: +(3 + r() * 3).toFixed(2) })
      out.push({ x, y, w, fill: FILLS[i++ % FILLS.length], wins })
      x += w + 6 + Math.floor(r() * 10)
    }
    return out
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="sky-glow absolute inset-0" />
      <svg className="absolute inset-x-0 bottom-0 h-[42%] w-full opacity-90" viewBox="0 0 1200 300" preserveAspectRatio="none">
        {buildings.map((b) => (
          <g key={b.x}>
            <rect x={b.x} y={b.y} width={b.w} height={300 - b.y} fill={b.fill} />
            {b.wins.map((w) => (
              <rect
                key={`${w.x}-${w.y}`}
                className="twinkle"
                x={w.x}
                y={w.y}
                width={12}
                height={14}
                style={{ animationDelay: `${w.d}s`, animationDuration: `${w.t}s` }}
              />
            ))}
          </g>
        ))}
      </svg>
      {[
        { Icon: Home, cls: 'top-[12%] left-[8%]', d: '9s', delay: '0s' },
        { Icon: KeyRound, cls: 'top-[68%] left-[88%]', d: '7.5s', delay: '1s' },
        { Icon: TrendingUp, cls: 'top-[22%] left-[82%]', d: '10.5s', delay: '2s' },
        { Icon: Building2, cls: 'top-[78%] left-[14%]', d: '8.5s', delay: '.5s' },
        { Icon: Warehouse, cls: 'top-[42%] left-[5%]', d: '11s', delay: '1.5s' },
        { Icon: MapPin, cls: 'top-[15%] left-[50%]', d: '9.5s', delay: '2.5s' },
      ].map(({ Icon, cls, d, delay }) => (
        <Icon
          key={cls}
          className={`float-icon absolute size-8 text-gold-light ${cls}`}
          style={{ animationDuration: d, animationDelay: delay }}
        />
      ))}
    </div>
  )
}
