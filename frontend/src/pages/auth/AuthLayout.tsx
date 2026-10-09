import type { ReactNode } from 'react'
import { Skyline } from '../../components/Skyline'

export function AuthLayout({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden bg-navy-dark px-4 py-10">
      <Skyline />
      <div className="relative z-10 w-full max-w-[420px] rounded-2xl bg-white p-7 shadow-[0_25px_60px_#00000055] sm:p-8">
        <img src="/logo-full.png" alt="Sai Space Realty" className="mx-auto w-36" width={144} height={138} />
        <h1 className="mt-3 text-center text-xl font-bold text-navy">{title}</h1>
        {sub && <p className="mt-1 text-center text-sm text-ink-dim">{sub}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  )
}
