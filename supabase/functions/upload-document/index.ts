// POST multipart/form-data { file, lead_id, booking_id?, type } -> { id }
// The ONLY way a document gets into the private bucket. Checks, in order:
// caller identity -> permission + lead visibility -> size -> real file type
// (magic bytes, not the extension or the browser-supplied MIME type).
import { admin, asCaller, callerId } from '../_shared/clients.ts'
import { guard, json } from '../_shared/http.ts'

const MAX = 10 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPES = ['kyc', 'agreement', 'receipt', 'other']

function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return { mime: 'image/png', ext: 'png' }
  return null
}

Deno.serve(async (req) => {
  const early = guard(req)
  if (early) return early

  const me = await callerId(req)
  if (!me) return json(req, { error: 'Not signed in' }, 401)
  if (Number(req.headers.get('content-length') ?? 0) > MAX + 64 * 1024) return json(req, { error: 'File is larger than 10 MB' }, 413)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(req, { error: 'Bad upload' }, 400)
  }
  const file = form.get('file')
  const leadId = String(form.get('lead_id') ?? '')
  const bookingId = String(form.get('booking_id') ?? '')
  const type = String(form.get('type') ?? 'other')
  if (!(file instanceof File) || !UUID.test(leadId) || (bookingId && !UUID.test(bookingId)) || !TYPES.includes(type))
    return json(req, { error: 'Bad upload' }, 400)
  if (file.size < 1 || file.size > MAX) return json(req, { error: 'File must be between 1 byte and 10 MB' }, 413)

  const { data: allowed } = await asCaller(req).rpc('can_upload_document', { p_lead: leadId })
  if (allowed !== true) return json(req, { error: 'You do not have permission to add documents for this client' }, 403)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  if (!kind) return json(req, { error: 'Only PDF, JPG and PNG files are accepted' }, 415)

  const path = `${leadId}/${crypto.randomUUID()}.${kind.ext}`
  const up = await admin.storage.from('documents').upload(path, bytes, { contentType: kind.mime, upsert: false })
  if (up.error) return json(req, { error: 'Could not store the file' }, 500)

  // keep only a safe display name (no paths, control chars or markup)
  const name = (file.name || 'document').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120)
  const { data: id, error } = await admin.rpc('svc_add_document', {
    p_actor: me, p_lead: leadId, p_booking: bookingId || null, p_type: type, p_path: path, p_name: name, p_mime: kind.mime, p_size: file.size,
  })
  if (error) {
    await admin.storage.from('documents').remove([path])
    return json(req, { error: 'Could not record the document' }, 500)
  }
  return json(req, { ok: true, id })
})
