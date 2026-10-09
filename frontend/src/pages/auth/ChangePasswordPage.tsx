import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Button, Field, Input } from '../../components/ui'
import { callFn } from '../../lib/api'
import { passwordProblems } from '../../lib/password'
import { AuthLayout } from './AuthLayout'

export function ChangePasswordPage() {
  const { me, refreshMe, logout } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const forced = !!me?.must_change_password
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const problems = passwordProblems(next, me?.username ?? '')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (problems.length) return setError('New password needs ' + problems.join(', ') + '.')
    if (next !== confirm) return setError('The two new passwords do not match.')
    setBusy(true)
    try {
      await callFn('change-password', { current_password: current, new_password: next })
      await refreshMe()
      toast('Password changed', 'ok')
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={forced ? 'Set your own password' : 'Change password'}
      sub={forced ? 'Your Admin gave you a temporary password. Choose a new one to continue.' : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={forced ? 'Temporary password' : 'Current password'}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field
          label="New password"
          hint="10+ characters with uppercase, lowercase and a digit. Passwords found in known data breaches are rejected."
        >
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {next && problems.length > 0 && <p className="text-xs text-warn">Still needs: {problems.join(', ')}</p>}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="gold" loading={busy} className="w-full">
          Save password
        </Button>
        {forced ? (
          <Button variant="ghost" onClick={() => void logout()} className="w-full">
            Sign out
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => navigate(-1)} className="w-full">
            Cancel
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
