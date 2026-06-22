import React, { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { C, customerStatus } from '../../tokens'
import { Card, Badge, TH, TD, useIsMobile } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Once Brian approves, the customer can see the 97% advance amount.
const APPROVED = ['Advance Confirmed', 'Advance Agreed', 'Advance Paid', 'Submitted to Ryder', 'Acknowledged', 'Resubmitted', 'Paid']

const DriveBadge = ({ url }) => (
  <a href={url || '#'} target={url ? '_blank' : undefined} rel="noreferrer" onClick={!url ? e => e.preventDefault() : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', border: `1px solid ${C.border}`, borderRadius: 6, color: '#1e40af', fontSize: 11, padding: '2px 7px', textDecoration: 'none' }}>
    <ExternalLink size={9} /> View
  </a>
)

// Friendly status pill — use raw status for colour, customer label for text.
const CustomerBadge = ({ status }) => <Badge status={status} label={customerStatus(status)} />

export default function AdvancedInvoices() {
  const isMobile = useIsMobile()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => { fetchInvoices() }, [])

  const fetchInvoices = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: client }   = await supabase.from('clients').select('id').eq('owner_id', user.id).single()
    if (!client) { setLoading(false); return }

    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, po_number, invoice_amount, advance_amount, submitted_at, status, drive_file_url')
      .eq('client_id', client.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (data) setInvoices(data)
    setLoading(false)
  }

  return (
    <div>
      <Card noPad>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading…</div>
        ) : isMobile ? (
          /* ── Mobile: stacked cards ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
            {invoices.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMut }}>No advanced invoices yet.</div>
            )}
            {invoices.map(inv => {
              const approved = APPROVED.includes(inv.status)
              const pendingConf = inv.status === 'Advance Confirmed'
              return (
                <div key={inv.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{inv.invoice_number}</span>
                    <CustomerBadge status={inv.status} />
                  </div>
                  {[
                    ['PO #', inv.po_number || '—'],
                    ['Invoice Amount', fmt(inv.invoice_amount)],
                    ['Advance', approved ? fmt(inv.advance_amount) : '—'],
                    ['Submitted', inv.submitted_at ? new Date(inv.submitted_at).toLocaleDateString() : '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12.5 }}>
                      <span style={{ color: C.textMut, fontWeight: 600 }}>{k}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: k === 'Advance' && approved ? C.primary : C.text, fontWeight: k === 'Advance' && approved ? 700 : 400 }}>{v}</span>
                    </div>
                  ))}
                  {pendingConf && (
                    <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#92400e' }}>
                      <strong>Action needed:</strong> Check your email and confirm this invoice to proceed.
                    </div>
                  )}
                  <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <DriveBadge url={inv.drive_file_url} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr>
                  <TH>Invoice #</TH>
                  <TH>PO #</TH>
                  <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                  <TH style={{ textAlign: 'right' }}>Advance </TH>
                  <TH>Submitted</TH>
                  <TH style={{ textAlign: 'center' }}>Status</TH>
                  <TH style={{ textAlign: 'center' }}>Invoice</TH>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const approved   = APPROVED.includes(inv.status)
                  const pendingConf = inv.status === 'Advance Confirmed'   // awaiting customer email confirmation
                  return (
                    <React.Fragment key={inv.id}>
                    <tr style={{ borderBottom: pendingConf ? 'none' : `1px solid ${C.border}` }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f5fdf8'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <TD mono>{inv.invoice_number}</TD>
                      <TD mono>{inv.po_number || '—'}</TD>
                      <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                      <TD accent style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {approved ? fmt(inv.advance_amount) : <span style={{ color: C.textMut, fontWeight: 400 }}>—</span>}
                      </TD>
                      <TD muted style={{ fontSize: 12 }}>{inv.submitted_at ? new Date(inv.submitted_at).toLocaleDateString() : '—'}</TD>
                      <TD style={{ textAlign: 'center' }}><CustomerBadge status={inv.status} /></TD>
                      <TD style={{ textAlign: 'center' }}><DriveBadge url={inv.drive_file_url} /></TD>
                    </tr>
                    {/* Inline note: this invoice needs the customer's email confirmation */}
                    {pendingConf && (
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td colSpan={7} style={{ padding: '0 14px 12px' }}>
                          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700 }}>Action needed:</span>
                            Please check your email inbox and confirm this invoice to proceed with your advance.
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })}
                {invoices.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>No advanced invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
