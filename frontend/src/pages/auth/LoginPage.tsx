import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, Button, Field, Input } from '../../components/ui'
import { supabaseConfigured } from '../../lib/supabase'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Enter both username and password.')
      return
    }
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError((err as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Sign in" sub="Enter your credentials to continue">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!supabaseConfigured && <Alert tone="warn">Server connection is not configured yet (.env.local).</Alert>}
        <Field label="Username">
          {(id) => (
            <Input
              id={id}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              maxLength={30}
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <div className="relative">
              <Input
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="pr-10"
                maxLength={200}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-faint hover:text-ink"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="gold" loading={busy} className="mt-1 w-full">
          Login
        </Button>
        <p className="border-t border-line pt-4 text-center text-xs leading-relaxed text-ink-faint">
          Accounts are created by your Admin. Forgot your password? Ask your Admin to reset it.
        </p>
      </form>
    </AuthLayout>
  )
}
