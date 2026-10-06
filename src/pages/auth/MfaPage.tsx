import { Smartphone } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, Button, Field, Input, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { AuthLayout } from './AuthLayout'

// Owner/Admin two-step verification with a free authenticator app (Google / Microsoft Authenticator).
// First sign-in: scan the QR code once. Every sign-in: type the app's current 6-digit code.
// The database grants an Owner/Admin nothing until this succeeds (migration 0016).
export function MfaPage() {
  const { logout, refreshMe } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice in development; enrol only once
    started.current = true
    ;(async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) {
        setError(error.message)
        setReady(true)
        return
      }
      const verified = data.totp.find((f) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
      } else {
        // first time: clear half-finished attempts, then show a fresh QR code
        for (const f of data.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
        const res = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator', issuer: 'Sai Space CRM' })
        if (res.error) setError('Could not start two-step setup. Sign out and try again.')
        else {
          setFactorId(res.data.id)
          setEnroll({ qr: res.data.totp.qr_code, secret: res.data.totp.secret })
        }
      }
      setReady(true)
    })()
  }, [])

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) {
      setError('That code is not correct. Use the code showing in the app right now, and make sure the phone’s time is set to automatic.')
      setCode('')
      return
    }
    await refreshMe()
  }

  return (
    <AuthLayout
      title={enroll ? 'Set up two-step verification' : 'Two-step verification'}
      sub={enroll ? 'One-time setup with a free authenticator app' : 'Enter the 6-digit code from your authenticator app'}
    >
      {!ready ? (
        <div className="grid place-items-center py-8 text-navy">
          <Spinner />
        </div>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          {enroll ? (
            <div className="rounded-xl bg-col p-4 text-sm text-ink-dim">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Install <b className="text-ink">Google Authenticator</b> or <b className="text-ink">Microsoft Authenticator</b> (free) on your phone.</li>
                <li>In the app tap <b className="text-ink">+</b> → <b className="text-ink">Scan a QR code</b>, and scan this:</li>
              </ol>
              <img src={enroll.qr} alt="QR code for your authenticator app" className="mx-auto my-3 size-44 rounded-lg bg-white p-2" />
              <p className="text-xs">
                Can’t scan? Choose <b>Enter a setup key</b> and type: <code className="font-mono break-all text-ink select-all">{enroll.secret}</code>
              </p>
              <p className="mt-2 text-xs">3. Type the 6-digit code the app now shows.</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-gold-tint px-4 py-3 text-sm text-gold-dark">
              <Smartphone className="size-5 shrink-0" />
              <span>Open Google or Microsoft Authenticator and find “Sai Space CRM”. The code changes every 30 seconds.</span>
            </div>
          )}
          <Field label="6-digit code">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="gold" loading={busy} disabled={code.length !== 6 || !factorId} className="w-full">
            Verify
          </Button>
          <Button variant="ghost" onClick={() => void logout()} className="w-full">
            Cancel and sign out
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
