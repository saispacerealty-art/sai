import { FunctionsHttpError } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileText, Upload, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../../components/Toast'
import { Alert, Badge, Button, Drawer, EmptyState, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea, Th } from '../../components/ui'
import { unwrap } from '../../lib/api'
import { rpc } from '../../lib/data'
import { fmtDate, inr } from '../../lib/format'
import { supabase } from '../../lib/supabase'

interface Client {
  lead_id: string
  name: string
  phone_hint: string | null
  project: string
  unit_no: string
  booking_id: string
  booking_status: 'pending' | 'approved'
  agreement_value: number
  received: number
  documents: number
  has_kyc: boolean
}
interface Doc {
  id: string
  type: 'kyc' | 'agreement' | 'receipt' | 'other'
  file_name: string
  size_bytes: number
  created_at: string
}
const DOC_LABEL = { kyc: 'KYC', agreement: 'Agreement', receipt: 'Receipt', other: 'Other' } as const

export function ClientsPage() {
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => rpc<Client[]>('list_clients') })
  const [open, setOpen] = useState<Client | null>(null)
  return (
    <>
      <PageHeader title="Clients" sub="Customers with a booking: payments, KYC and documents." />
      {clients.isLoading ? (
        <Loading />
      ) : clients.error ? (
        <Alert>{(clients.error as Error).message}</Alert>
      ) : (clients.data ?? []).length === 0 ? (
        <EmptyState icon={UsersRound} title="No clients yet" hint="A lead becomes a client when a unit is booked for them." />
      ) : (
        <Table
          head={
            <tr>
              <Th>Client</Th>
              <Th>Unit</Th>
              <Th right>Agreement value</Th>
              <Th right>Collected</Th>
              <Th>KYC</Th>
              <Th>Documents</Th>
              <Th>Booking</Th>
            </tr>
          }
        >
          {clients.data!.map((c) => (
            <tr key={c.booking_id} className="cursor-pointer hover:bg-canvas" onClick={() => setOpen(c)}>
              <Td>
                <div className="font-semibold text-ink">{c.name}</div>
                <div className="text-xs text-ink-faint">{c.phone_hint}</div>
              </Td>
              <Td className="text-ink-dim">
                {c.project} · {c.unit_no}
              </Td>
              <Td right className="font-semibold text-navy">{inr(c.agreement_value)}</Td>
              <Td right className="text-ink-dim">
                {inr(c.received)} <span className="text-xs text-ink-faint">({c.agreement_value ? Math.round((c.received / c.agreement_value) * 100) : 0}%)</span>
              </Td>
              <Td>{c.has_kyc ? <Badge tone="ok">On file</Badge> : <Badge tone="warn">Missing</Badge>}</Td>
              <Td className="text-ink-dim">{c.documents}</Td>
              <Td>
                <Badge tone={c.booking_status === 'approved' ? 'ok' : 'warn'}>{c.booking_status}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {open && <ClientDrawer client={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function ClientDrawer({ client, onClose }: { client: Client; onClose: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const canWrite = !can('read_only')
  const [kyc, setKyc] = useState<{ pan: string; id_number: string; address: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [docType, setDocType] = useState<Doc['type']>('kyc')
  const [uploading, setUploading] = useState(false)

  const docs = useQuery({
    queryKey: ['documents', client.lead_id],
    queryFn: async () =>
      unwrap(await supabase.from('documents').select('id, type, file_name, size_bytes, created_at').eq('lead_id', client.lead_id).order('created_at', { ascending: false })) as Doc[],
  })

  async function reveal() {
    try {
      const k = await rpc<{ pan: string | null; id_number: string | null; address: string | null }>('get_client_profile', { p_lead: client.lead_id })
      setKyc({ pan: k.pan ?? '', id_number: k.id_number ?? '', address: k.address ?? '' })
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function save() {
    setSaving(true)
    try {
      await rpc('set_client_profile', { p_lead: client.lead_id, p_pan: kyc!.pan, p_id_number: kyc!.id_number, p_address: kyc!.address })
      void qc.invalidateQueries({ queryKey: ['clients'] })
      toast('KYC saved (encrypted)', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setSaving(false)
    }
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast('File is larger than 10 MB', 'bad')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('lead_id', client.lead_id)
      form.append('booking_id', client.booking_id)
      form.append('type', docType)
      const { error } = await supabase.functions.invoke('upload-document', { body: form })
      if (error) {
        const msg = error instanceof FunctionsHttpError ? ((await error.context.json().catch(() => null))?.error ?? 'Upload failed') : 'Cannot reach the server'
        throw new Error(msg)
      }
      void qc.invalidateQueries({ queryKey: ['documents', client.lead_id] })
      void qc.invalidateQueries({ queryKey: ['clients'] })
      toast('Document uploaded', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setUploading(false)
    }
  }
  async function download(d: Doc) {
    try {
      const path = await rpc<string>('log_document_download', { p_document: d.id }) // permission check + audit entry
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300, { download: d.file_name })
      if (error || !data) throw new Error('Could not open the document')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  return (
    <Drawer open onClose={onClose} title={client.name} subtitle={`${client.project} · Unit ${client.unit_no} · ${inr(client.agreement_value, { exact: true })}`}>
      <h3 className="mb-2 text-xs font-bold tracking-wide text-ink-faint uppercase">KYC details</h3>
      {!kyc ? (
        <div className="rounded-xl border border-line bg-canvas p-4 text-sm text-ink-dim">
          <p>PAN, ID number and address are stored encrypted. Opening them is recorded in the audit log.</p>
          <Button size="sm" className="mt-3" onClick={reveal}>
            <Eye className="size-3.5" /> Show KYC details
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PAN">{(id) => <Input id={id} value={kyc.pan} disabled={!canWrite} onChange={(e) => setKyc({ ...kyc, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" />}</Field>
            <Field label="Aadhaar / ID number">{(id) => <Input id={id} value={kyc.id_number} disabled={!canWrite} onChange={(e) => setKyc({ ...kyc, id_number: e.target.value })} maxLength={40} />}</Field>
          </div>
          <Field label="Address">{(id) => <Textarea id={id} value={kyc.address} disabled={!canWrite} onChange={(e) => setKyc({ ...kyc, address: e.target.value })} maxLength={400} />}</Field>
          {canWrite && (
            <Button className="self-end" loading={saving} onClick={save}>
              Save KYC
            </Button>
          )}
        </div>
      )}

      <h3 className="mt-6 mb-2 text-xs font-bold tracking-wide text-ink-faint uppercase">Documents</h3>
      {canWrite && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={docType} onChange={(e) => setDocType(e.target.value as Doc['type'])} className="!w-auto" aria-label="Document type">
            {Object.entries(DOC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-gold-light hover:bg-navy-dark">
            <Upload className="size-4" /> {uploading ? 'Uploading…' : 'Upload file'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
          </label>
          <span className="text-xs text-ink-faint">PDF, JPG or PNG · max 10 MB</span>
        </div>
      )}
      {docs.isLoading ? (
        <Loading />
      ) : (docs.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-dim">No documents uploaded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.data!.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <FileText className="size-5 shrink-0 text-gold-dark" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{d.file_name}</div>
                <div className="text-xs text-ink-faint">
                  {DOC_LABEL[d.type]} · {(d.size_bytes / 1024).toFixed(0)} KB · {fmtDate(d.created_at)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => download(d)}>
                <Download className="size-3.5" /> Open
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">Download links expire after 5 minutes. Every download is logged.</p>
    </Drawer>
  )
}
