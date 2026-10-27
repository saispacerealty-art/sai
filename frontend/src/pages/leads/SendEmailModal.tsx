import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { Button, Field, Input, Modal, Textarea } from '../../components/ui'
import { callFn } from '../../lib/api'
import type { Lead } from './data'

export function SendEmailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState(`Hello ${lead.name.split(' ')[0]},\n\n\n\nRegards,\nSai Space Realty`)
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      await callFn('mail', { action: 'send', lead_id: lead.id, subject, body })
      void qc.invalidateQueries({ queryKey: ['timeline', lead.id] })
      toast('Email sent', 'ok')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open title={`Email ${lead.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <Field label="Subject">{(id) => <Input id={id} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Message" hint="Sent to the email address on the lead. Logged on the timeline (stored encrypted).">
          {(id) => <Textarea id={id} rows={9} value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={sending} disabled={!subject.trim() || !body.trim()} onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </Modal>
  )
}
