import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { Alert, Button, Card, Field, Input, Loading } from '../../components/ui'
import { callFn } from '../../lib/api'
import { rpc } from '../../lib/data'

export interface MailAccount {
  from_name: string
  from_email: string
  smtp_host: string
  smtp_port: number
  smtp_user: string
  updated_at: string
}

export function MailTab() {
  const account = useQuery({ queryKey: ['mail-account'], queryFn: () => rpc<MailAccount | null>('get_mail_account') })
  return account.isLoading ? <Loading /> : <MailForm initial={account.data ?? null} />
}

export function MailForm({ initial, mine = false }: { initial: MailAccount | null; mine?: boolean }) {
  const suffix = mine ? '_mine' : ''
  const queryKey = [mine ? 'my-mailbox' : 'mail-account']
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({
    from_name: initial?.from_name ?? 'Sai Space Realty',
    from_email: initial?.from_email ?? '',
    host: initial?.smtp_host ?? '',
    port: initial?.smtp_port ?? 587,
    user: initial?.smtp_user ?? '',
    password: '',
  })
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  async function run(action: 'test' | 'save') {
    setBusy(action)
    try {
      await callFn('mail', { action: action + suffix, ...f })
      if (action === 'save') {
        set({ password: '' })
        void qc.invalidateQueries({ queryKey })
        void qc.invalidateQueries({ queryKey: ['mail-sender'] })
      }
      toast(action === 'save' ? 'Mailbox saved' : 'Connection works', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('save')
    try {
      await callFn('mail', { action: 'delete_mine' })
      void qc.invalidateQueries({ queryKey })
      void qc.invalidateQueries({ queryKey: ['mail-sender'] })
      toast('Mailbox removed', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="max-w-3xl">
      <p className="mb-4 text-sm text-ink-dim">
        {mine
          ? 'Connect your own mailbox. Emails you send to leads then go out from your own address and are logged on the lead's timeline. Without one, the company mailbox is used.'
          : 'Connect the company mailbox.'}{' '} Staff can then email leads from the lead page, and every email is logged on that lead&apos;s timeline. Works with any provider that
        offers SMTP (Gmail, Outlook, Zoho, your own domain).
      </p>
      <Alert tone="warn">
        Gmail and Microsoft 365 need an <b>app password</b> (not your normal password). The password is stored encrypted and is never shown again.
      </Alert>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Sender name">{(id) => <Input id={id} value={f.from_name} maxLength={80} onChange={(e) => set({ from_name: e.target.value })} />}</Field>
        <Field label="Sender email">{(id) => <Input id={id} type="email" value={f.from_email} maxLength={254} onChange={(e) => set({ from_email: e.target.value })} placeholder="sales@yourcompany.com" />}</Field>
        <Field label="Mail server (SMTP)" hint="e.g. smtp.gmail.com, smtp.office365.com, smtp.zoho.in">
          {(id) => <Input id={id} value={f.host} maxLength={253} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" />}
        </Field>
        <Field label="Port" hint="587 (most providers) or 465">
          {(id) => (
            <select id={id} value={f.port} onChange={(e) => set({ port: Number(e.target.value) })} className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink">
              {[587, 465, 25, 2525].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Username">{(id) => <Input id={id} value={f.user} maxLength={254} autoComplete="off" onChange={(e) => set({ user: e.target.value })} />}</Field>
        <Field label="Password / app password" hint={initial ? 'Leave blank to keep the saved one' : undefined}>
          {(id) => <Input id={id} type="password" value={f.password} maxLength={256} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} />}
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {mine && initial && (
          <Button variant="outline" disabled={busy !== null} onClick={remove}>
            Remove
          </Button>
        )}
        <Button variant="outline" loading={busy === 'test'} disabled={busy !== null} onClick={() => run('test')}>
          Test connection
        </Button>
        <Button variant="gold" loading={busy === 'save'} disabled={busy !== null} onClick={() => run('save')}>
          Save
        </Button>
      </div>
    </Card>
  )
}
