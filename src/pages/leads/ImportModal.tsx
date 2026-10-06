import { FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, Button, Field, Modal, Select } from '../../components/ui'
import { downloadCsv, parseCsv } from '../../lib/csv'
import { rpc, usePeople } from '../../lib/data'
import { parseMoney } from '../../lib/format'

const FIELDS = [
  { key: 'name', label: 'Name', required: true, match: /^(name|lead|customer|client|full.?name)/i },
  { key: 'phone', label: 'Mobile', required: true, match: /(phone|mobile|contact|number|cell)/i },
  { key: 'email', label: 'Email', match: /mail/i },
  { key: 'source', label: 'Source', match: /source|channel|portal/i },
  { key: 'budget_max', label: 'Budget', match: /budget|price|value/i },
  { key: 'config_wanted', label: 'Configuration', match: /config|bhk|type/i },
  { key: 'note', label: 'Note', match: /note|remark|comment|requirement/i },
] as const
type FieldKey = (typeof FIELDS)[number]['key']
type Result = { created: number; duplicates: number; rejected: { row: number; error: string }[] }

async function readFile(file: File): Promise<string[][]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.')
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser')
    const sheet = await readSheet(file)
    return sheet.map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString() : String(c))))
  }
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text())
  throw new Error('Choose a .csv or .xlsx file.')
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth()
  const people = usePeople()
  const [rows, setRows] = useState<string[][] | null>(null)
  const [map, setMap] = useState<Partial<Record<FieldKey, number>>>({})
  const [owner, setOwner] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function load(file: File) {
    setError(null)
    setResult(null)
    try {
      const data = await readFile(file)
      if (data.length < 2) throw new Error('The file needs a header row and at least one lead.')
      if (data.length > 2001) throw new Error('Import up to 2000 leads at a time.')
      const auto: Partial<Record<FieldKey, number>> = {}
      data[0].forEach((h, i) => {
        const f = FIELDS.find((x) => x.match.test(h.trim()) && auto[x.key] === undefined)
        if (f) auto[f.key] = i
      })
      setRows(data)
      setMap(auto)
    } catch (e) {
      setRows(null)
      setError((e as Error).message)
    }
  }

  async function run() {
    if (!rows || map.name === undefined || map.phone === undefined) return setError('Choose which columns hold the Name and the Mobile number.')
    setBusy(true)
    setError(null)
    try {
      const payload = rows.slice(1).map((r) => {
        const o: Record<string, string> = {}
        for (const f of FIELDS) {
          const i = map[f.key]
          if (i === undefined) continue
          const v = (r[i] ?? '').trim()
          if (f.key === 'budget_max') {
            const n = parseMoney(v)
            if (n && !Number.isNaN(n)) o[f.key] = String(n)
          } else if (v) o[f.key] = v
        }
        return o
      })
      setResult(await rpc<Result>('import_leads', { p_rows: payload, p_owner: owner || null }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const headers = rows?.[0] ?? []
  return (
    <Modal open wide title="Import leads" onClose={onClose}>
      {result ? (
        <div className="flex flex-col gap-4">
          <Alert tone="ok">
            <b>{result.created}</b> leads added · <b>{result.duplicates}</b> already existed (logged as repeat enquiries) · <b>{result.rejected.length}</b> rejected
          </Alert>
          {result.rejected.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-line text-sm">
              {result.rejected.map((r) => (
                <div key={r.row} className="border-b border-line px-3 py-1.5 last:border-0">
                  Row {r.row + 1}: <span className="text-bad">{r.error}</span>
                </div>
              ))}
            </div>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line bg-canvas px-4 py-7 text-center hover:border-gold">
            <FileSpreadsheet className="size-8 text-gold" />
            <span className="text-sm font-semibold text-navy">{rows ? `${rows.length - 1} rows loaded — choose another file` : 'Choose an Excel (.xlsx) or CSV file'}</span>
            <span className="text-xs text-ink-faint">First row must be column headings. Up to 2000 leads, 5 MB.</span>
            <input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </label>
          <button
            type="button"
            className="self-start text-xs font-semibold text-gold-dark"
            onClick={() => downloadCsv('lead-import-template.csv', ['Name', 'Mobile', 'Email', 'Source', 'Budget', 'Configuration', 'Note'], [['Amit Sharma', '9876543210', '', '99acres', '85L', '2 BHK', 'Wants higher floor']])}
          >
            Download a template
          </button>

          {rows && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <Field key={f.key} label={f.label + ('required' in f ? ' *' : '')}>
                    {(id) => (
                      <Select id={id} value={map[f.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                        <option value="">— skip —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
                {can('leads.assign') && (
                  <Field label="Assign all to">
                    {(id) => (
                      <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
                        <option value="">Share out automatically</option>
                        {(people.data ?? []).filter((p) => p.is_active).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-xs">
                  <tbody>
                    {rows.slice(0, 4).map((r, i) => (
                      <tr key={i} className={i === 0 ? 'bg-canvas font-semibold' : 'border-t border-line'}>
                        {r.slice(0, 8).map((c, j) => (
                          <td key={j} className="max-w-40 truncate px-2.5 py-1.5">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy} disabled={!rows} onClick={run}>
              Import {rows ? rows.length - 1 : ''} leads
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
