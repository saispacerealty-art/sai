import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Modal } from '../../components/ui'
import { callFn } from '../../lib/api'
import type { Employee } from './data'
import { generateTempPassword } from './tempPassword'

export function ResetPasswordModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const qc = useQueryClient()
  const [temp, setTemp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reset() {
    setBusy(true)
    setError(null)
    const pw = generateTempPassword()
    try {
      await callFn('admin-users', { action: 'reset_password', user_id: employee.id, temp_password: pw })
      setTemp(pw)
      void qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Reset password" onClose={onClose}>
      {temp ? (
        <div className="flex flex-col gap-4">
          <Alert tone="ok">Password reset. {employee.full_name} has been signed out of all devices.</Alert>
          <TempPasswordBox username={employee.username} password={temp} />
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-dim">
            This creates a new temporary password for <b className="text-ink">{employee.full_name}</b>, signs them out everywhere, and asks them
            to choose their own password on next sign-in.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy} onClick={reset}>
              Reset password
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function TempPasswordBox({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-xl border border-gold/40 bg-gold-tint p-4">
      <p className="text-xs font-semibold text-gold-dark uppercase">Share privately — shown only once</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-dim">Username</dt>
        <dd className="font-mono font-semibold select-all">{username}</dd>
        <dt className="text-ink-dim">Temp password</dt>
        <dd className="font-mono font-semibold select-all">{password}</dd>
      </dl>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={async () => {
          await navigator.clipboard.writeText(`Username: ${username}\nTemporary password: ${password}`)
          setCopied(true)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
