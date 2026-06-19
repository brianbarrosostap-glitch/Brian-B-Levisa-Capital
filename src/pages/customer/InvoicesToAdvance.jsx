import React, { useState, useEffect } from 'react'
import { Check, X, ExternalLink } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Btn, TH, TD, Modal, ModalBody, ModalFooter, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// "Remove" on the customer list is UI-only (the invoice stays in Drive / DB).
// We persist hidden ids in localStorage so a removed row stays hidden on refresh.
const HIDE_KEY = 'customer.hiddenInvoices'
const getHidden = () => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')) }
  catch { return new Set() }
}
const hideInvoice = (id) => {
  const h = getHidden(); h.add(id)
  localStorage.setItem(HIDE_KEY, JSON.stringify([...h]))
}

const DriveBadge = ({ url }) => (
  <a href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" onClick={!url ? e => e.preventDefault() : undefined} style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#eff6ff', border: `1px solid ${C.border}`,
    borderRadius: 6, color: '#1e40af', fontSize: 11, padding: '2px 7px', textDecoration: 'none',
  }}>
    <ExternalLink size={9} /> View
  </a>
)

/* ── Remove Modal ── */
function RemoveModal({ inv, onClose, onConfirm }) {
  return (
    <Modal onClose={onClose} title="Remove from advance list?" width={420}>
      <ModalBody>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} color={C.red} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, marginBottom: 6 }}>
              Remove {inv.invoice_number} ({fmt(inv.invoice_amount)}) from your upcoming advance request.
            </div>
            <div style={{ fontSize: 12.5, color: C.textSm, lineHeight: 1.5 }}>
              The invoice stays in Google Drive and can be included in a future request.
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Btn variant="secondary" size="sm" onClick={onClose}>Keep it</Btn>
        <Btn variant="danger"    size="sm" onClick={() => { onConfirm(); onClose() }}>Remove Invoice</Btn>
      </ModalFooter>
    </Modal>
  )
}

/* ── Submit Confirmation Modal ── */
function SubmitModal({ selected, onClose, onSubmit }) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const total = selected.reduce((s, i) => s + Number(i.invoice_amount), 0)

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    try {
      await callFunction('submit-advance-request', { invoice_ids: selected.map(i => i.id) })
      onSubmit()
      onClose()
    } catch (e) {
      console.error(e)
      setError(e?.message || 'Could not submit the request. Please try again.')
    }
    setLoading(false)
  }

  return (
    <Modal onClose={onClose} title="Confirm Advance Request" subtitle={`${selected.length} selected — review before sending`} width={500}>
      <ModalBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', textAlign: 'center', borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Invoices</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textB }}>{selected.length}</div>
          </div>
          <div style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Invoice Total</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.textB, fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Included Invoices</div>
        {selected.map(inv => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{inv.invoice_number}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{fmt(inv.invoice_amount)}</span>
          </div>
        ))}

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 13px', fontSize: 12.5, color: '#1e40af', marginTop: 16 }}>
          Funds are wired after Levisa reviews and confirms. Your invoices will show as <strong>Submitted</strong> until then.
        </div>
        {error && (
          <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 13px', fontSize: 12.5, color: '#991b1b', marginTop: 10 }}>
            {error}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Btn variant="ghost" onClick={onClose}>Go back</Btn>
        <Btn onClick={handleSubmit} disabled={loading}>
          <Check size={13} /> {loading ? 'Submitting…' : 'Confirm & Submit'}
        </Btn>
      </ModalFooter>
    </Modal>
  )
}

export default function InvoicesToAdvance() {
  const isMobile = useIsMobile()
  const [invoices, setInvoices] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [removeModal, setRemoveModal] = useState(null)
  const [submitModal, setSubmitModal] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [syncedAt, setSyncedAt] = useState(null)

  useEffect(() => { fetchInvoices() }, [])

  const fetchInvoices = async () => {
    setLoading(true)
    // Get current user's client invoices that are eligible to be included
    const { data: { user } } = await supabase.auth.getUser()
    const { data: client }   = await supabase.from('clients').select('id').eq('owner_id', user.id).single()

    if (!client) { setLoading(false); return }

    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, unit_number, invoice_date, invoice_amount, advance_amount, status, drive_file_url, updated_at')
      .eq('client_id', client.id)
      .in('status', ['Uploaded', 'Eligible'])
      .order('invoice_date', { ascending: false })

    if (data) {
      // Respect locally-hidden invoices (UI-only "remove", persisted across refresh).
      const hidden = getHidden()
      setInvoices(data.filter(i => !hidden.has(i.id)))
      setSyncedAt(new Date())
    }
    setLoading(false)
  }

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const allSelected = invoices.length > 0 && invoices.every(i => selected.has(i.id))
  const toggleAll   = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(invoices.map(i => i.id)))
  }

  const selectedInvoices = invoices.filter(i => selected.has(i.id))
  const totalAmount = selectedInvoices.reduce((s, i) => s + Number(i.invoice_amount), 0)

  const minutesAgo = syncedAt ? Math.floor((Date.now() - syncedAt) / 60000) : null

  return (
    <div style={{ position: 'relative' }}>
      {/* Sync line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, fontSize: 11.5, color: C.textMut }}>
        <svg width="14" height="14" viewBox="0 0 87.3 78" fill="none" style={{ flexShrink: 0 }}>
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA"/>
          <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.35C.4 49.75 0 51.3 0 52.85h27.5L43.65 25z" fill="#00AC47"/>
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.2c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.2 7.9 12.55z" fill="#EA4335"/>
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2L43.65 25z" fill="#00832D"/>
          <path d="M59.8 52.85H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.55 1.2h50.7c1.65 0 3.2-.45 4.55-1.2L59.8 52.85z" fill="#2684FC"/>
          <path d="M73.4 26.45L60.7 4.5C59.9 3.1 58.75 2 57.4 1.2L43.65 25l16.15 27.85h27.45c0-1.55-.4-3.1-1.2-4.5l-12.65-21.9z" fill="#FFBA00"/>
        </svg>
        Synced from Google Drive{minutesAgo != null ? ` · updated ${minutesAgo < 1 ? 'just now' : `${minutesAgo} min ago`}` : ''}
      </div>

      <Card noPad>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading invoices…</div>
        ) : isMobile ? (
          /* ── Mobile: stacked selectable cards ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
            {invoices.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMut }}>No eligible invoices found.</div>
            )}
            {invoices.map(inv => {
              const on = selected.has(inv.id)
              return (
                <div key={inv.id}
                  onClick={() => toggle(inv.id)}
                  style={{ border: `1px solid ${on ? C.primary : C.border}`, borderRadius: 10, padding: '12px 14px', background: on ? '#f1faf5' : '#fff', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{inv.invoice_number}</span>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${on ? C.primary : C.borderMd}`, background: on ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {on && <Check size={11} color="#fff" strokeWidth={3} />}
                    </div>
                  </div>
                  {[
                    ['Invoice Date', new Date(inv.invoice_date).toLocaleDateString()],
                    ['Unit #', inv.unit_number],
                    ['Invoice Amount', fmt(inv.invoice_amount)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12.5 }}>
                      <span style={{ color: C.textMut, fontWeight: 600 }}>{k}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: C.text }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span onClick={e => e.stopPropagation()}><DriveBadge url={inv.drive_file_url} /></span>
                    <button onClick={e => { e.stopPropagation(); setRemoveModal(inv) }} style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} color={C.textMut} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr>
                <TH style={{ width: 44, textAlign: 'center' }}>
                  <div onClick={toggleAll} style={{ width: 16, height: 16, borderRadius: 4, cursor: 'pointer', border: `2px solid ${allSelected ? C.primary : C.borderMd}`, background: allSelected ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                    {allSelected && <Check size={10} color="#fff" strokeWidth={3} />}
                  </div>
                </TH>
                <TH>Invoice Date</TH>
                <TH>Invoice #</TH>
                <TH>Unit #</TH>
                <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                <TH style={{ textAlign: 'center' }}>Invoice</TH>
                <TH style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const on = selected.has(inv.id)
                return (
                  <tr key={inv.id}
                    style={{ background: on ? '#f1faf5' : 'transparent', cursor: 'pointer' }}
                    onClick={() => toggle(inv.id)}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#f5fdf8' }}
                    onMouseLeave={e => { e.currentTarget.style.background = on ? '#f1faf5' : 'transparent' }}
                  >
                    <TD style={{ textAlign: 'center', padding: '11px 14px' }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${on ? C.primary : C.borderMd}`, background: on ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                        {on && <Check size={10} color="#fff" strokeWidth={3} />}
                      </div>
                    </TD>
                    <TD muted>{new Date(inv.invoice_date).toLocaleDateString()}</TD>
                    <TD mono>{inv.invoice_number}</TD>
                    <TD muted>{inv.unit_number}</TD>
                    <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                    <TD style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><DriveBadge url={inv.drive_file_url} /></TD>
                    <TD style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => setRemoveModal(inv)} style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={12} color={C.textMut} />
                      </button>
                    </TD>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>No eligible invoices found.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* Sticky Action Bar */}
      <div style={{ position: 'sticky', bottom: 16, marginTop: 16, background: C.sidebar, borderRadius: 10, padding: '13px 22px', boxShadow: '0 2px 20px rgba(0,0,0,0.14)', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 28, flex: 1, minWidth: 200 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Selected</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{selectedInvoices.length} of {invoices.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Invoice Total</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmt(totalAmount)}</div>
          </div>
        </div>
        <button
          onClick={() => selectedInvoices.length > 0 && setSubmitModal(true)}
          disabled={selectedInvoices.length === 0}
          style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: selectedInvoices.length === 0 ? 'rgba(255,255,255,0.25)' : '#fff', color: selectedInvoices.length === 0 ? 'rgba(255,255,255,0.4)' : C.primary, fontWeight: 700, fontSize: 13.5, cursor: selectedInvoices.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
        >
          Submit Advance Request
        </button>
      </div>

      {removeModal && (
        <RemoveModal inv={removeModal} onClose={() => setRemoveModal(null)}
          onConfirm={() => {
            hideInvoice(removeModal.id)
            setInvoices(prev => prev.filter(i => i.id !== removeModal.id))
            setSelected(prev => { const n = new Set(prev); n.delete(removeModal.id); return n })
          }}
        />
      )}
      {submitModal && (
        <SubmitModal selected={selectedInvoices} onClose={() => setSubmitModal(false)} onSubmit={fetchInvoices} />
      )}
    </div>
  )
}
