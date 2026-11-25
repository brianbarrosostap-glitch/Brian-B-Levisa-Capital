import React, { useState, useRef, useEffect } from 'react'
import { Upload, Loader2, Circle, XCircle, X, Link2, FileText } from 'lucide-react'
import { C } from '../tokens'
import { Modal, ModalBody, ModalFooter, Btn } from './ui'
import StatusPill from './StatusPill'
import { callFunction } from '../lib/supabase'
import { uploadDocumentFile, MAX_UPLOAD_BYTES } from '../lib/files'
import { adminJobStatus, customerJobStatus, fmtMoney } from '../lib/documentJobs'
import { errorMessage } from '../lib/errors'

const ACCEPT = {
  invoice: '.pdf,.xlsx,.xls,.csv',
  cheque:  'image/*,.heic,.heif,.pdf',
}
const EXT_OK = {
  invoice: /\.(pdf|xlsx|xls|csv)$/i,
  cheque:  /\.(pdf|heic|heif|png|jpe?g|gif|webp|bmp|tiff?)$/i,
}
const SHEET_RE = /^https:\/\/(docs|drive)\.google\.com\/\S+$/i

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
  border: `1.5px solid ${C.borderMd}`, fontSize: 14.5, color: C.text, outline: 'none',
  background: C.card, fontFamily: 'inherit',
}
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 700, color: C.textSm, marginBottom: 6 }

let seq = 0
const nextKey = () => `u${++seq}`

/**
 * Upload invoices (customer or admin) or cheques (admin) into Storage and
 * have them read by `process-document`, one at a time.
 *
 * props: kind 'invoice'|'cheque', clientId, clients? (admin picker list),
 *        role? 'admin'|'customer' (defaults: admin when clients given or kind is cheque),
 *        onClose, onDone (called once every item has finished)
 */
export default function UploadDocumentModal({ kind = 'invoice', clientId, clients, role, onClose, onDone }) {
  const isAdmin = role ? role === 'admin' : (Array.isArray(clients) || kind === 'cheque')
  const noun = kind === 'cheque' ? 'cheque' : 'invoice'
  const showPicker = isAdmin && kind === 'invoice' && Array.isArray(clients)

  const [files, setFiles]       = useState([])      // File[]
  const [sheetUrl, setSheetUrl] = useState('')
  const [pickedClient, setPickedClient] = useState(clientId || clients?.[0]?.id || '')
  const [items, setItems]       = useState([])      // { key, name, phase, job?, error? }
  const [running, setRunning]   = useState(false)
  const [finished, setFinished] = useState(false)
  const [formError, setFormError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  // Client list may arrive after the modal opens → default to the first.
  useEffect(() => {
    if (!pickedClient && clients?.length) setPickedClient(clientId || clients[0].id)
  }, [clients, clientId, pickedClient])

  const addFiles = (list) => {
    const arr = Array.from(list || [])
    const ok = arr.filter(f => EXT_OK[kind].test(f.name) || (kind === 'cheque' && f.type?.startsWith('image/')))
    if (ok.length < arr.length) setFormError(`Skipped ${arr.length - ok.length} file(s) of an unsupported type.`)
    else setFormError('')
    setFiles(prev => [...prev, ...ok])
  }

  const removeFile = (i) => setFiles(prev => prev.filter((_, n) => n !== i))

  const update = (key, patch) => setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it))

  const effectiveClient = kind === 'invoice' ? (showPicker ? pickedClient : clientId) : (clientId || null)
  const sheet = kind === 'invoice' ? sheetUrl.trim() : ''
  const count = files.length + (sheet ? 1 : 0)

  const start = async () => {
    if (count === 0) { setFormError(`Choose at least one file${kind === 'invoice' ? ' or paste a link' : ''}.`); return }
    if (sheet && !SHEET_RE.test(sheet)) { setFormError('The link must be a Google Sheets or Google Drive link (https://docs.google.com/… or https://drive.google.com/…).'); return }
    if (kind === 'invoice' && !effectiveClient) { setFormError(isAdmin ? 'Pick a client first.' : 'Your account is not linked to a client yet. Please contact Levisa Capital.'); return }
    setFormError('')

    const queue = [
      ...files.map(f => ({ key: nextKey(), name: f.name, file: f })),
      ...(sheet ? [{ key: nextKey(), name: sheet, sheet_url: sheet }] : []),
    ]
    setItems(queue.map(q => ({ key: q.key, name: q.name, isLink: !!q.sheet_url, phase: 'queued' })))
    setRunning(true)

    // One at a time — reading can take up to a minute per file, and a
    // failure on one item must never stop the rest.
    for (const q of queue) {
      try {
        let body
        if (q.file) {
          if (q.file.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 25 MB')
          update(q.key, { phase: 'uploading' })
          const { path } = await uploadDocumentFile(kind, effectiveClient, q.file)
          body = { kind, storage_path: path, original_filename: q.file.name, client_id: effectiveClient }
        } else {
          body = { kind: 'invoice', sheet_url: q.sheet_url, client_id: effectiveClient }
        }
        update(q.key, { phase: 'reading' })
        const res = await callFunction('process-document', body)
        update(q.key, { phase: 'done', job: res?.job || null })
      } catch (e) {
        console.error('upload/process failed:', e)
        const msg = await errorMessage(e, 'Upload failed')
        update(q.key, { phase: 'error', error: isAdmin ? msg : 'Could not upload this file. Please try again.' })
      }
    }

    setRunning(false)
    setFinished(true)
    onDone?.()
  }

  const reset = () => { setFiles([]); setSheetUrl(''); setItems([]); setFinished(false); setFormError('') }

  const handleClose = () => {
    if (running && !window.confirm('Files are still being read. Close anyway? Remaining files will keep processing in the background.')) return
    onClose?.()
  }

  const started = items.length > 0

  return (
    <Modal onClose={handleClose} width={600}
      title={kind === 'cheque' ? 'Upload cheques' : 'Upload invoices'}
      subtitle={kind === 'cheque'
        ? 'Photos or PDFs of Ryder cheques — each is read automatically, matched to its invoices, and those invoices are marked Paid (no approval needed)'
        : 'PDF, Excel or CSV files — each one is read automatically'}
      accentHeader>
      <ModalBody>
        {!started && (
          <>
            {showPicker && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Client</label>
                <select value={pickedClient} onChange={e => setPickedClient(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {(clients || []).length === 0 && <option value="">Loading clients…</option>}
                  {(clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Drop zone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              style={{
                border: `2px dashed ${dragOver ? C.primary : C.borderMd}`, borderRadius: 12,
                background: dragOver ? C.primLt : C.panel, padding: '26px 16px', textAlign: 'center', cursor: 'pointer',
              }}>
              <Upload size={22} color={C.primary} />
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 8 }}>
                Click to choose {noun} files, or drop them here
              </div>
              <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 4 }}>
                {kind === 'cheque' ? 'Images (JPG, PNG, HEIC) or PDF' : 'PDF, XLSX, XLS or CSV'} · up to 25 MB each · multiple allowed
              </div>
              <input ref={inputRef} type="file" multiple accept={ACCEPT[kind]} style={{ display: 'none' }}
                onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 14 }}>
                    <FileText size={14} color={C.textMut} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>{f.name}</span>
                    <span style={{ color: f.size > MAX_UPLOAD_BYTES ? C.red : C.textMut, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button type="button" onClick={() => removeFile(i)} title="Remove" style={{
                      width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: C.card,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}><X size={11} color={C.textMut} /></button>
                  </div>
                ))}
              </div>
            )}

            {kind === 'invoice' && (
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>Or paste a Google Sheet / Drive link</label>
                <div style={{ position: 'relative' }}>
                  <Link2 size={14} color={C.textMut} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
                  <input value={sheetUrl} onChange={e => { setSheetUrl(e.target.value); setFormError('') }}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    style={{ ...inputStyle, paddingLeft: 32 }} />
                </div>
                <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 5 }}>
                  Make sure the link is shared so “anyone with the link” can view it.
                </div>
              </div>
            )}

            {formError && <div style={{ fontSize: 14, color: C.red, marginTop: 12 }}>{formError}</div>}
          </>
        )}

        {started && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {items.map((it, i) => (
              <ItemRow key={it.key} item={it} first={i === 0} isAdmin={isAdmin} noun={noun} />
            ))}
          </div>
        )}
        {started && running && (
          <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 10 }}>
            Reading can take up to a minute per file. Please keep this window open.
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {!started && (
          <>
            <Btn variant="secondary" onClick={handleClose}>Cancel</Btn>
            <Btn onClick={start} disabled={count === 0}>
              <Upload size={13} /> Upload {count > 0 ? `${count} item${count === 1 ? '' : 's'}` : ''}
            </Btn>
          </>
        )}
        {started && (
          <>
            {finished && <Btn variant="secondary" onClick={reset}>Upload more</Btn>}
            <Btn onClick={handleClose} disabled={running}>{running ? 'Working…' : 'Done'}</Btn>
          </>
        )}
      </ModalFooter>
    </Modal>
  )
}

function ItemRow({ item, first, isAdmin, noun }) {
  const { phase, job } = item
  let icon, line1, line2 = null

  if (phase === 'queued') {
    icon = <Circle size={15} color={C.borderMd} />
    line1 = <span style={{ color: C.textMut }}>Waiting…</span>
  } else if (phase === 'uploading' || phase === 'reading') {
    icon = <Loader2 size={15} color={C.primary} className="lc-spin" />
    line1 = <span style={{ color: C.primary, fontWeight: 600 }}>{phase === 'uploading' ? 'Uploading…' : `Reading ${noun}…`}</span>
  } else if (phase === 'error') {
    icon = <XCircle size={15} color={C.red} />
    line1 = <span style={{ color: C.red, fontWeight: 600 }}>{item.error}</span>
  } else {
    const base = isAdmin ? adminJobStatus(job?.status) : customerJobStatus(job)
    // A cheque that was saved has already marked its invoices Paid — say so.
    const s = noun === 'cheque' && job?.status === 'added' ? { ...base, label: 'Applied' } : base
    icon = null
    line1 = <StatusPill label={s.label} tone={s.tone} small />
    const ex = job?.extracted || {}
    const ref = noun === 'cheque'
      ? [ex.check_number && `Cheque ${ex.check_number}`, ex.amount != null && fmtMoney(ex.amount)]
      : [ex.invoice_number && `Invoice ${ex.invoice_number}`, ex.invoice_amount != null && fmtMoney(ex.invoice_amount)]
    const detail = isAdmin ? job?.status_reason : s.note
    line2 = (
      <>
        {ref.filter(Boolean).join(' · ')}
        {ref.some(Boolean) && detail ? ' — ' : ''}
        {detail}
        {!job && 'Processed'}
      </>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderTop: first ? 'none' : `1px solid ${C.border}` }}>
      <div style={{ width: 16, paddingTop: 2, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.isLink ? 'Google Sheet link' : item.name}
        </div>
        {item.isLink && <div style={{ fontSize: 12, color: C.textMut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>}
        <div style={{ fontSize: 13, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {line1}
          {line2 && <span style={{ fontSize: 12.5, color: C.textSm }}>{line2}</span>}
        </div>
      </div>
    </div>
  )
}
